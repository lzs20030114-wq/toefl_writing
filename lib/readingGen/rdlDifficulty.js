/**
 * RDL Difficulty Estimator — measures difficulty from the finished item
 * (passage + questions), mirroring ctwDifficulty's architecture: the label
 * is MEASURED after generation, never trusted from the model's self-report.
 *
 * IMPORTANT CAVEATS:
 *  - Unlike CTW, RDL has no real-exam corpus in data/realExam2026/ to anchor
 *    against. These labels are observable-proxy estimates used for mock-exam
 *    routing preferences (with pool-size fallback in readingPlanner); they
 *    must never become a hard gate standard.
 *  - Labels are RELATIVE TO THE VARIANT NORM: long items are inherently
 *    harder than short ones (3 questions incl. main_idea, denser texts), so
 *    each variant has its own thresholds. "hard short" ≠ "hard long" on an
 *    absolute scale — the mock planner picks short and long from separate
 *    pools, so per-variant labels are exactly what routing consumes.
 *
 * Difficulty drivers (all measurable on the finished item; thresholds set
 * from the feature distributions of the 368-item live bank, boundary items
 * hand-checked 2026-07-10):
 *   1. Question type mix — inference/main_idea require reasoning over the
 *      text; detail questions only require locating a stated fact.
 *   2. Correct-answer paraphrase distance — a correct option sharing few
 *      content words with the passage forces synonym mapping or
 *      multi-sentence synthesis (bank p50 overlap: detail .67-1.0,
 *      inference .20-.43).
 *   3. Distractor passage-word borrowing — distractors that reuse passage
 *      vocabulary with changed relationships are the hardest to eliminate
 *      (bank p50 borrow: short .22, long .47).
 *   4. Passage register — share of long words (>=7 chars), same proxy the
 *      CTW gate uses. (The CTW EASY/MEDIUM word sets are NOT reused here:
 *      they were built for science passages and misclassify ~70% of campus
 *      vocabulary as rare.)
 *   5. Passage length relative to the variant's normal range.
 */

// Base cognitive load per question type (0-10 scale contribution)
const QTYPE_BASE = {
  detail: 2,
  vocabulary_in_context: 3,
  tone: 3.5,
  main_idea: 3.5,
  inference: 4.5,
};

// Per-variant label thresholds (score <= easy → "easy", >= hard → "hard").
// Set at natural breaks of the live-bank score distribution; see header.
const THRESHOLDS = {
  short: { easy: 3.4, hard: 4.8 },
  long: { easy: 4.6, hard: 5.9 },
};

function contentWords(text, minLen = 4) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z'\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= minLen);
}

/**
 * Score a single question's difficulty (0 = easiest, 10 = hardest).
 * @param {object} q — { question_type, options: {A..D}, correct_answer }
 * @param {string} passageLower — lowercased passage text
 */
function scoreQuestion(q, passageLower) {
  let score = QTYPE_BASE[q.question_type] ?? 2.5;

  // Paraphrase distance: how many of the correct option's content words
  // appear verbatim in the passage. High overlap = "find and match" (easy);
  // low overlap = synonym substitution or multi-sentence synthesis (hard).
  const correct = (q.options && q.options[q.correct_answer]) || "";
  const cw = contentWords(correct);
  if (cw.length >= 2) {
    const overlap = cw.filter((w) => passageLower.includes(w)).length / cw.length;
    if (overlap >= 0.6) score += 0;
    else if (overlap >= 0.3) score += 0.75;
    else score += 1.5;
  }

  // Distractor trap strength: average passage-word borrowing across the
  // wrong options. Borrowed-word distractors are hard to eliminate;
  // distractors with no passage vocabulary are easy to discard.
  const distractors = Object.entries(q.options || {})
    .filter(([k]) => k !== q.correct_answer)
    .map(([, v]) => v);
  if (distractors.length > 0) {
    const ratios = distractors.map((d) => {
      const dw = contentWords(d);
      if (dw.length === 0) return 0;
      return dw.filter((w) => passageLower.includes(w)).length / dw.length;
    });
    const avgBorrow = ratios.reduce((s, v) => s + v, 0) / ratios.length;
    if (avgBorrow >= 0.45) score += 1.5;
    else if (avgBorrow >= 0.2) score += 0.75;
  }

  return Math.max(0, Math.min(10, score));
}

/**
 * Share of long words (>=7 chars) among words >=3 chars — register proxy.
 */
function longWordShare(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z'\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (words.length === 0) return 0;
  return words.filter((w) => w.length >= 7).length / words.length;
}

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Estimate overall RDL item difficulty.
 *
 * @param {object} item — { text, variant, questions: [...] }
 * @returns {{ difficulty: "easy"|"medium"|"hard", score: number, questionScores: number[] }}
 */
function estimateRdlDifficulty(item) {
  if (!item || !item.text || !Array.isArray(item.questions) || item.questions.length === 0) {
    return { difficulty: "medium", score: 5, questionScores: [] };
  }

  const passageLower = item.text.toLowerCase();
  const questionScores = item.questions.map((q) => scoreQuestion(q, passageLower));
  let score = questionScores.reduce((s, v) => s + v, 0) / questionScores.length;

  // Passage-level adjustments (up to +1.75)
  const lw = longWordShare(item.text);
  if (lw >= 0.36) score += 0.75;
  else if (lw >= 0.28) score += 0.25;

  const wcount = countWords(item.text);
  const isShort = item.variant === "short";
  if (isShort) {
    if (wcount > 55) score += 0.5;
  } else {
    if (wcount > 190) score += 1;
    else if (wcount > 150) score += 0.5;
  }

  score = Math.max(0, Math.min(10, score));

  const t = isShort ? THRESHOLDS.short : THRESHOLDS.long;
  let difficulty;
  if (score <= t.easy) difficulty = "easy";
  else if (score >= t.hard) difficulty = "hard";
  else difficulty = "medium";

  return {
    difficulty,
    score: +score.toFixed(2),
    questionScores: questionScores.map((s) => +s.toFixed(2)),
  };
}

module.exports = { estimateRdlDifficulty, scoreQuestion, longWordShare, QTYPE_BASE, THRESHOLDS };
