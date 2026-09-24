/**
 * Sentence timings for listening audio — the one contract shared by
 *   · the render pipeline (lib/tts/renderListening.js measures them while stitching),
 *   · the bank JSON (`item.sentence_timings`, written next to `audio_url` by the render scripts),
 *   · lib/realBank.js (passes them through to the 真题 items), and
 *   · the player (click a sentence in the transcript → play exactly that span).
 * Spec and caveats: docs/listening-sentence-timings.md
 *
 * Shape (seconds, 3 decimals):
 *   [{ text, start, end, turn?, speaker? }]
 *   · `text` is the sentence exactly as it was rendered (the player renders THIS list, it
 *     never re-splits the transcript — two splitters drifting apart is how sentences and
 *     audio stop lining up).
 *   · `start`/`end` are both numbers, or both null for a sentence that could not be
 *     located (only alignment-derived timings do that; a render never does). A null entry
 *     still lists the sentence, it is just not playable on its own.
 *   · `turn` / `speaker` only on conversations (index into item.conversation + speaker name).
 */

export const SENTENCE_TIMINGS_FIELD = "sentence_timings";

/**
 * How far before `start` a player should seek. Timings are measured on the stitched WAV;
 * MP3 encode + decode add a lead-in of up to ~46ms (LAME encoder delay 576 + decoder
 * delay 529 samples at 24 kHz) that browsers do not all strip. Backing off by this much
 * never cuts a word: the previous sentence is followed by ≥120ms of silence.
 */
export const SENTENCE_SEEK_LEAD_SEC = 0.06;

const isFiniteNonNeg = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Validate + normalize a raw `sentence_timings` value. Returns a clean array, or null
 * when anything about it is off — a half-trusted list is worse than none, because a
 * single shifted entry would put every later click on the wrong sentence.
 *
 * Rules: array of objects; non-empty `text`; start/end both finite non-negative with
 * end ≥ start, or both null; located entries must not move backwards in time;
 * optional `turn` (non-negative integer) and `speaker` (non-empty string) are kept.
 */
export function normalizeSentenceTimings(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = [];
  let lastStart = -Infinity;
  for (const e of raw) {
    if (!e || typeof e !== "object") return null;
    const text = typeof e.text === "string" ? e.text.trim() : "";
    if (!text) return null;
    const located = e.start != null || e.end != null;
    let start = null;
    let end = null;
    if (located) {
      if (!isFiniteNonNeg(e.start) || !isFiniteNonNeg(e.end) || e.end < e.start) return null;
      if (e.start < lastStart) return null;
      start = e.start;
      end = e.end;
      lastStart = start;
    }
    const entry = { text, start, end };
    if (Number.isInteger(e.turn) && e.turn >= 0) entry.turn = e.turn;
    if (typeof e.speaker === "string" && e.speaker.trim()) entry.speaker = e.speaker.trim();
    out.push(entry);
  }
  return out;
}

/** Sentences the player can actually seek to (start/end present). */
export function playableSentences(timings) {
  const list = normalizeSentenceTimings(timings);
  return list ? list.filter((s) => s.start != null) : [];
}
