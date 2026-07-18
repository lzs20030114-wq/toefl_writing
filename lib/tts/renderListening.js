"use strict";
/**
 * renderListening.js — production render path for listening audio.
 *
 * renderConversation(item): the deterministic persona layer end to end.
 *   derivePersona(item) -> per turn, split into sentences -> one TTS call per sentence
 *   (so a question's rising intonation never bleeds into the next sentence) ->
 *   loudness-normalize + concat with intra-turn and (larger) inter-turn gaps.
 *
 * Question rise: instructionsForSentence appends toneDirector.QUESTION_RISE_CLAUSE to
 *   yes/no & tag questions so their pitch audibly rises — the strong per-sentence clause (V2)
 *   won a 2026-07-18 manual A/B listening test. Genuine wh-questions ("What changed?") are
 *   excepted: they fall in English, so forcing a rise sounds unnatural (ETS listening does
 *   the same). Leading discourse markers (so/well/…) are stripped before the wh check.
 *
 * This is the only place that touches the network; the deciders it calls
 * (derivePersona / renderInstructions / instructionsForSentence / wavTools) are all pure.
 */
const openai = require("./openaiTts");
const { derivePersona, renderInstructions, QUESTION_RISE_CLAUSE } = require("./toneDirector");
const { concatWavSegments, splitSentences } = require("./wavTools");
const { deriveSpeakerMeta } = require("./speakerMeta");

const INTRA_TURN_GAP_MS = 120; // between sentences of one speaker
const INTER_TURN_GAP_MS = 280; // between speakers

/**
 * @param {object} item   a listening conversation item (speakers[] + conversation[])
 * @param {object} [opts]
 * @param {(text,o)=>Promise<Buffer>} [opts.generate]  TTS fn (defaults to openaiTts.generateSpeech, format wav)
 * @returns {Promise<Buffer>} one WAV buffer
 */
// A conversation render makes ~8-12 sequential TTS calls; one transient timeout/socket
// drop would otherwise abort the whole item. Retry transient failures a few times.
const TRANSIENT_RE = /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket|EPIPE/i;
async function generateWithRetry(text, o, attempts = 3) {
  let lastErr;
  for (let a = 0; a < attempts; a++) {
    try {
      return await openai.generateSpeech(text, { ...o, format: "wav" });
    } catch (e) {
      lastErr = e;
      if (!TRANSIENT_RE.test(String(e && e.message))) throw e; // non-transient -> fail fast
    }
  }
  throw lastErr;
}

// Leading discourse markers to peel off before the wh-question check, so "So what changed?"
// still classifies as wh. One or more, case-insensitive, with any trailing punctuation/space.
const DISCOURSE_MARKER_RE = /^(?:(?:so|and|but|well|ok|okay|now|then)\b[\s,]*)+/i;
// wh-questions fall in English; forcing a rise sounds unnatural, so they DON'T get the clause.
const WH_HEAD_RE = /^(?:what|why|how|when|where|which|who|whose|whom)\b/i;

// Append QUESTION_RISE_CLAUSE to non-wh question sentences; leave statements (and wh-questions)
// on the plain persona instructions. See the file header for the 2026-07-18 listening-test basis.
function instructionsForSentence(baseInstructions, sentence) {
  const s = String(sentence || "").trim();
  if (!s.endsWith("?")) return baseInstructions;
  const head = s.replace(DISCOURSE_MARKER_RE, "").trimStart();
  if (WH_HEAD_RE.test(head)) return baseInstructions;
  return `${baseInstructions} ${QUESTION_RISE_CLAUSE}`;
}

async function renderConversation(item, opts = {}) {
  const generate = opts.generate || generateWithRetry;
  const type = opts.type || "lc"; // two-speaker conversation; parameterized for symmetry
  const personas = derivePersona(item, type);
  const byName = {};
  personas.forEach((p, i) => { byName[p.name == null ? i : p.name] = p; });

  const turns = Array.isArray(item.conversation) ? item.conversation : [];
  if (!turns.length) throw new Error("renderConversation: item has no conversation turns");

  const turnWavs = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const persona = byName[t.speaker] != null ? byName[t.speaker] : personas[i % personas.length];
    const instructions = renderInstructions(persona); // persona-only
    const sentenceWavs = [];
    for (const sentence of splitSentences(t.text)) {
      // Split per sentence so a question's rise doesn't bleed into the next; append the
      // rise clause per-sentence for non-wh questions.
      const instr = instructionsForSentence(instructions, sentence);
      sentenceWavs.push(await generate(sentence, { voice: persona.voice, instructions: instr }));
    }
    turnWavs.push(concatWavSegments(sentenceWavs, { gapMs: INTRA_TURN_GAP_MS }));
  }
  // Turn wavs are already per-sentence normalized; stitch with the larger inter-turn gap.
  return concatWavSegments(turnWavs, { gapMs: INTER_TURN_GAP_MS, normalizeSegments: false });
}

// The spoken-text field differs per single-speaker type; keep this the single source of truth.
function singleSpeakerText(item, type) {
  if (type === "lat") return item && (item.transcript || item.lecture);
  if (type === "la") return item && (item.announcement || item.transcript);
  if (type === "lcr") return item && (item.speaker || item.prompt);
  return item && (item.transcript || item.announcement || item.speaker);
}

/**
 * renderSingleSpeaker(item, type) — persona render for the single-speaker listening
 * types (lat = lecture, la = announcement, lcr = choose-a-response utterance).
 *
 * Same machinery as renderConversation, minus the multi-voice turn loop: mint the
 * missing { gender, role } via deriveSpeakerMeta → derivePersona picks a gender-locked
 * safe voice + temperament → split into sentences (no question-intonation bleed) → one
 * TTS call per sentence → loudness-normalize + concat with a short inter-sentence gap.
 *
 * @param {object} item
 * @param {"lat"|"la"|"lcr"} type
 * @param {object} [opts]
 * @param {(text,o)=>Promise<Buffer>} [opts.generate] TTS fn (defaults to openaiTts.generateSpeech, wav)
 * @returns {Promise<Buffer>} one WAV buffer
 */
async function renderSingleSpeaker(item, type, opts = {}) {
  const generate = opts.generate || generateWithRetry;
  const text = String(singleSpeakerText(item, type) || "").trim();
  if (!text) throw new Error(`renderSingleSpeaker: item ${item && item.id} has no ${type} text to render`);

  // deriveSpeakerMeta is pure; the spread keeps item untouched (no _speaker persisted upstream).
  const [persona] = derivePersona({ ...item, _speaker: deriveSpeakerMeta(item, type) }, type);
  const instructions = renderInstructions(persona); // persona-only

  const sentenceWavs = [];
  for (const sentence of splitSentences(text)) {
    const instr = instructionsForSentence(instructions, sentence);
    sentenceWavs.push(await generate(sentence, { voice: persona.voice, instructions: instr }));
  }
  if (!sentenceWavs.length) throw new Error(`renderSingleSpeaker: no sentences parsed from ${item && item.id}`);
  // Single continuous monologue: use the short intra-turn gap between sentences.
  return concatWavSegments(sentenceWavs, { gapMs: INTRA_TURN_GAP_MS });
}

module.exports = { renderConversation, renderSingleSpeaker, singleSpeakerText, instructionsForSentence, INTRA_TURN_GAP_MS, INTER_TURN_GAP_MS };
