"use strict";
/**
 * renderListening.js — production render path for listening audio.
 *
 * renderConversation(item): the deterministic persona layer end to end.
 *   derivePersona(item) -> per turn, split into sentences -> one TTS call per sentence
 *   (so a question's rising intonation never bleeds into the next sentence) ->
 *   loudness-normalize + concat with intra-turn and (larger) inter-turn gaps.
 *
 * Per-line tone deltas are OPTIONAL: pass toneByTurn (or leave undefined for the
 * persona-only / neutral render). This is the only place that touches the network;
 * the deciders it calls (derivePersona / renderInstructions / wavTools) are all pure.
 */
const openai = require("./openaiTts");
const { derivePersona, renderInstructions } = require("./toneDirector");
const { concatWavSegments, splitSentences } = require("./wavTools");

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

async function renderConversation(item, opts = {}) {
  const generate = opts.generate || generateWithRetry;
  const personas = derivePersona(item, "lc");
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
      // Split per sentence so the model's NATIVE question rise doesn't bleed into the next.
      sentenceWavs.push(await generate(sentence, { voice: persona.voice, instructions }));
    }
    turnWavs.push(concatWavSegments(sentenceWavs, { gapMs: INTRA_TURN_GAP_MS }));
  }
  // Turn wavs are already per-sentence normalized; stitch with the larger inter-turn gap.
  return concatWavSegments(turnWavs, { gapMs: INTER_TURN_GAP_MS, normalizeSegments: false });
}

module.exports = { renderConversation, INTRA_TURN_GAP_MS, INTER_TURN_GAP_MS };
