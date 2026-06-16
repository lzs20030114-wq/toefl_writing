"use strict";
/**
 * Pure, deterministic per-item detectors for Complete-the-Words (CTW) passages.
 * Consumed by the generic gate harness (lib/gate/gateHarness.js).
 *
 * Returns ONE {dimName: numericValue} object per item. All detectors are pure
 * functions of the passage text (no I/O, no AI) → 1.0 precision, safe to hard-gate.
 *
 * Text field is auto-detected: the REAL corpus uses `paragraph` (OCR prose),
 * the generated bank uses `passage`. Only PASSAGE-level dims are computed here —
 * the real corpus's OCR blanks are truncated, so blank-level dims are intentionally
 * NOT derived from it (see data/eval-profiles/ctw.json notes).
 */

function textOf(item) {
  return String((item && (item.passage || item.paragraph || item.text)) || "").trim();
}
function words(s) {
  return s.split(/\s+/).filter(Boolean);
}
function lettersLen(w) {
  return w.replace(/[^A-Za-z]/g, "").length;
}
function sentences(s) {
  return s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function std(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); }

function measureItem(item) {
  const text = textOf(item);
  const w = words(text);
  const sents = sentences(text);
  const s1 = words(sents[0] || "");
  const s1lens = s1.map(lettersLen).filter((n) => n > 0);
  const sentWordCounts = sents.map((x) => words(x).length);
  return {
    passage_word_count: w.length,
    sentence_count: sents.length,
    first_sentence_words: s1.length,
    first_sentence_avg_word_len: mean(s1lens),
    first_sentence_long_word_share: s1lens.length ? s1lens.filter((n) => n >= 7).length / s1lens.length : 0,
    sentence_length_cv: mean(sentWordCounts) ? std(sentWordCounts) / mean(sentWordCounts) : 0,
  };
}

function measure(items) {
  return (items || []).map(measureItem);
}

module.exports = { measure, measureItem, _internal: { textOf, words, sentences, mean, std, lettersLen } };
