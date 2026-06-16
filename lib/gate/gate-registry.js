"use strict";
/**
 * Per-type dimension registry for the generic regression-gate harness.
 *
 * This is the "self-evolving" surface: adding a new evaluation dimension (or a whole
 * new question type) = ONE reviewed entry here + one pure detector fn. The harness then
 * auto-derives that dimension's frozen target FROM THE REAL CORPUS and auto-incorporates
 * it into derive → freshness → self-check → gate → history. Humans supply the detector +
 * the gating policy/tolerance/precision; the system does the derivation & incorporation.
 *
 * Invariants enforced by validateRegistry() below (audited 2026-06-17):
 *  - realPath must be a REAL-exam corpus, never a generated bank/staging (derive-from-real-only).
 *  - every dimension declares an EXPLICIT policy ∈ {hard, drift, monitor} + detector_precision + why_added.
 *  - hard-gate is FORBIDDEN unless detector_precision >= 0.95 (else monitor-only) — a noisy
 *    detector can never silently false-reject good items (this is why BS's relClause/passive
 *    are direction-only and casual_opener is a drift band).
 *  - hard/drift dimensions require a numeric tolerance.
 * A malformed entry throws at import, before any gate can run.
 */
const ctwMeasurer = require("./measurers/ctw.js");

const HARD_GATE_MIN_PRECISION = 0.95;
const POLICIES = ["hard", "drift", "monitor"];

const REGISTRY = {
  // ── Complete-the-Words (2nd type; BS remains on its own live scorer for now) ──
  ctw: {
    type: "ctw",
    realPath: "data/realExam2026/reading/completeTheWords.json", // REAL only — derive targets here
    realItemsKey: "items",
    standardPath: "data/eval-profiles/ctw-gate-standard.json",
    fixturePath: "data/eval-profiles/ctw-selfcheck-degraded.json",
    measure: ctwMeasurer.measure,
    dimensions: [
      { name: "passage_word_count", policy: "hard", agg: "mean", tol: 9, detector_precision: 1.0,
        why_added: "real passages run ~71w; generated collapse to ~56w, destroying the intact-tail shape (ctw.json D2/D6)" },
      { name: "first_sentence_words", policy: "hard", agg: "mean", tol: 3, detector_precision: 1.0,
        why_added: "real topic sentence ~16.7w vs generated ~12.9w; S1 is intact in OCR so this is exact (ctw.json D7)" },
      { name: "first_sentence_avg_word_len", policy: "hard", agg: "mean", tol: 0.45, detector_precision: 1.0,
        why_added: "real S1 avg word length 5.89 vs generated 5.09 — register too simple (ctw.json D7)" },
      { name: "first_sentence_long_word_share", policy: "hard", agg: "mean", tol: 0.10, detector_precision: 1.0,
        why_added: "real S1 long-word(>=7ch) share 0.389 vs generated 0.255 (ctw.json D7)" },
      { name: "sentence_count", policy: "monitor", agg: "mean", detector_precision: 0.9,
        why_added: "OCR sentence-boundary glue makes this partial-reliability → informational only (ctw.json caveat)" },
      { name: "sentence_length_cv", policy: "monitor", agg: "mean", detector_precision: 0.7,
        why_added: "real CV ~0.30 vs generated 0.134 (too uniform); partial reliability (OCR) → monitor only (ctw.json D11)" },
    ],
  },
};

function validateRegistry(reg) {
  for (const [type, cfg] of Object.entries(reg)) {
    if (!cfg.realPath || /[\\/](bank|staging)[\\/]|questions\.json/.test(cfg.realPath)) {
      throw new Error(`[registry] ${type}: realPath must be a REAL-exam corpus, never a generated bank/staging (got "${cfg.realPath}")`);
    }
    if (typeof cfg.measure !== "function") throw new Error(`[registry] ${type}: measure must be a function`);
    if (!Array.isArray(cfg.dimensions) || cfg.dimensions.length === 0) throw new Error(`[registry] ${type}: dimensions[] required`);
    for (const d of cfg.dimensions) {
      if (!d.name) throw new Error(`[registry] ${type}: a dimension is missing "name"`);
      if (!POLICIES.includes(d.policy)) throw new Error(`[registry] ${type}.${d.name}: policy must be one of ${POLICIES.join("/")}`);
      if (typeof d.detector_precision !== "number" || d.detector_precision < 0 || d.detector_precision > 1) {
        throw new Error(`[registry] ${type}.${d.name}: detector_precision must be a number in [0,1]`);
      }
      if (!d.why_added) throw new Error(`[registry] ${type}.${d.name}: why_added (rationale) required`);
      if (d.policy === "hard" && d.detector_precision < HARD_GATE_MIN_PRECISION) {
        throw new Error(`[registry] ${type}.${d.name}: hard-gate FORBIDDEN — detector_precision ${d.detector_precision} < ${HARD_GATE_MIN_PRECISION}; demote to monitor-only`);
      }
      if ((d.policy === "hard" || d.policy === "drift") && typeof d.tol !== "number") {
        throw new Error(`[registry] ${type}.${d.name}: ${d.policy} dimension requires a numeric "tol"`);
      }
    }
  }
  return true;
}

validateRegistry(REGISTRY); // fail-fast at import
Object.freeze(REGISTRY);
for (const cfg of Object.values(REGISTRY)) { Object.freeze(cfg); cfg.dimensions.forEach(Object.freeze); }

module.exports = { REGISTRY, validateRegistry, HARD_GATE_MIN_PRECISION, POLICIES };
