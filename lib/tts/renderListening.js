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
 * Sentence timings: because every sentence is its own TTS call, the stitch step knows
 *   exactly where each one starts and ends. renderConversationTimed / renderSingleSpeakerTimed
 *   return { wav, sentences: [{ text, start, end, turn?, speaker? }] } (seconds, 3 decimals)
 *   and the render scripts persist that as `item.sentence_timings` next to `audio_url`, so the
 *   player can jump to / loop one sentence. Contract + caveats (MP3 lead-in, what a consumer
 *   may assume): docs/listening-sentence-timings.md and lib/listening/sentenceTimings.js.
 *   renderConversation / renderSingleSpeaker are the same renders returning only the WAV.
 *
 * This is the only place that touches the network; the deciders it calls
 * (derivePersona / renderInstructions / instructionsForSentence / wavTools) are all pure.
 */
const openai = require("./openaiTts");
const { derivePersona, renderInstructions, QUESTION_RISE_CLAUSE } = require("./toneDirector");
const { concatWavSegmentsTimed, splitSentences } = require("./wavTools");
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

// Seconds → milliseconds precision. Sentence-level seeking needs no more, and it keeps
// the bank JSON from carrying 15-digit floats.
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * renderConversationTimed(item, opts) — the conversation render, returning the WAV plus
 * where every sentence sits in it:
 *   { wav, sentences: [{ turn, speaker, text, start, end }] }   start/end in seconds
 * `turn` is the index into item.conversation, `speaker` that turn's speaker name.
 */
async function renderConversationTimed(item, opts = {}) {
  const generate = opts.generate || generateWithRetry;
  const type = opts.type || "lc"; // two-speaker conversation; parameterized for symmetry
  const personas = derivePersona(item, type);
  const byName = {};
  personas.forEach((p, i) => { byName[p.name == null ? i : p.name] = p; });

  const turns = Array.isArray(item.conversation) ? item.conversation : [];
  if (!turns.length) throw new Error("renderConversation: item has no conversation turns");

  const turnWavs = [];
  const turnSentences = []; // per turn: [{ turn, speaker, text, start, end }] relative to the turn's own WAV
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const persona = byName[t.speaker] != null ? byName[t.speaker] : personas[i % personas.length];
    const instructions = renderInstructions(persona); // persona-only
    const sentenceWavs = [];
    const texts = [];
    for (const sentence of splitSentences(t.text)) {
      // Split per sentence so a question's rise doesn't bleed into the next; append the
      // rise clause per-sentence for non-wh questions.
      const instr = instructionsForSentence(instructions, sentence);
      sentenceWavs.push(await generate(sentence, { voice: persona.voice, instructions: instr }));
      texts.push(sentence);
    }
    const stitched = concatWavSegmentsTimed(sentenceWavs, { gapMs: INTRA_TURN_GAP_MS });
    turnWavs.push(stitched.wav);
    turnSentences.push(stitched.segments.map((seg, k) => ({
      turn: i,
      ...(t.speaker != null ? { speaker: t.speaker } : {}),
      text: texts[k],
      start: seg.start,
      end: seg.end,
    })));
  }
  // Turn wavs are already per-sentence normalized; stitch with the larger inter-turn gap.
  const outer = concatWavSegmentsTimed(turnWavs, { gapMs: INTER_TURN_GAP_MS, normalizeSegments: false });
  const sentences = [];
  outer.segments.forEach((turnSeg, i) => {
    for (const s of turnSentences[i]) {
      sentences.push({ ...s, start: round3(turnSeg.start + s.start), end: round3(turnSeg.start + s.end) });
    }
  });
  return { wav: outer.wav, sentences };
}

/** renderConversation(item, opts) — same render, WAV only (legacy callers). */
async function renderConversation(item, opts = {}) {
  return (await renderConversationTimed(item, opts)).wav;
}

// The spoken-text field differs per single-speaker type; keep this the single source of truth.
function singleSpeakerText(item, type) {
  if (type === "lat") return item && (item.transcript || item.lecture);
  if (type === "la") return item && (item.announcement || item.transcript);
  if (type === "lcr") return item && (item.speaker || item.prompt);
  return item && (item.transcript || item.announcement || item.speaker);
}

/**
 * renderSingleSpeakerTimed(item, type) — persona render for the single-speaker listening
 * types (lat = lecture, la = announcement, lcr = choose-a-response utterance), returning
 * the WAV plus sentence timings: { wav, sentences: [{ text, start, end }] } (seconds).
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
 * @returns {Promise<{ wav: Buffer, sentences: Array<{ text: string, start: number, end: number }> }>}
 */
async function renderSingleSpeakerTimed(item, type, opts = {}) {
  const generate = opts.generate || generateWithRetry;
  const text = String(singleSpeakerText(item, type) || "").trim();
  if (!text) throw new Error(`renderSingleSpeaker: item ${item && item.id} has no ${type} text to render`);

  // deriveSpeakerMeta is pure; the spread keeps item untouched (no _speaker persisted upstream).
  const [persona] = derivePersona({ ...item, _speaker: deriveSpeakerMeta(item, type) }, type);
  const instructions = renderInstructions(persona); // persona-only

  const sentenceWavs = [];
  const texts = [];
  for (const sentence of splitSentences(text)) {
    const instr = instructionsForSentence(instructions, sentence);
    sentenceWavs.push(await generate(sentence, { voice: persona.voice, instructions: instr }));
    texts.push(sentence);
  }
  if (!sentenceWavs.length) throw new Error(`renderSingleSpeaker: no sentences parsed from ${item && item.id}`);
  // Single continuous monologue: use the short intra-turn gap between sentences.
  const stitched = concatWavSegmentsTimed(sentenceWavs, { gapMs: INTRA_TURN_GAP_MS });
  const sentences = stitched.segments.map((seg, k) => ({ text: texts[k], start: round3(seg.start), end: round3(seg.end) }));
  return { wav: stitched.wav, sentences };
}

/** renderSingleSpeaker(item, type, opts) — same render, WAV only (legacy callers). */
async function renderSingleSpeaker(item, type, opts = {}) {
  return (await renderSingleSpeakerTimed(item, type, opts)).wav;
}

module.exports = {
  renderConversation, renderConversationTimed,
  renderSingleSpeaker, renderSingleSpeakerTimed,
  singleSpeakerText, instructionsForSentence, INTRA_TURN_GAP_MS, INTER_TURN_GAP_MS,
};
