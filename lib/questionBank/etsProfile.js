/**
 * Build a Sentence — TPO-calibrated statistics (60 questions, 6 sets).
 *
 * Single source of truth for all validation gates, difficulty scoring,
 * style checks, and generation prompts.
 *
 * All numbers below are derived from 6 TPO real exam sets analysis.
 * TPO represents actual test difficulty, significantly harder than
 * the ETS example/low-difficulty sets analyzed previously.
 */

/* ---------- Set-level style targets (TPO standard) ---------- */
const ETS_STYLE_TARGETS = Object.freeze({
  // Question mark: TPO 8% questions / 92% statements
  // Per 10-question set: 0-2 questions, 8-10 statements
  qmarkMin: 0,
  qmarkMax: 2,

  // Distractor: TPO 88% (53/60) — nearly every item has a distractor
  distractorMin: 7,
  distractorMax: 10,

  // Embedded/indirect question: TPO 63% (38/60) — core test point
  embeddedMin: 5,
  embeddedMax: 8,

  // Negation: TPO 20% (12/60) — often combined with indirect questions
  negationMin: 2,
  negationMax: 4,
});

/* ---------- Difficulty distribution (10-question set, TPO) ---------- */
// TPO overall: easy 7% / medium 68% / hard 25%
// For 10 questions: 1/7/2 is the target split
const ETS_DIFFICULTY_COUNTS_10 = Object.freeze({
  easy: 1,
  medium: 7,
  hard: 2,
});

const ETS_DIFFICULTY_RATIO = Object.freeze({
  easy: 0.1,
  medium: 0.7,
  hard: 0.2,
});

/* ---------- Reference profile for similarity scoring ---------- */
// Means derived from TPO-set analysis and used by compare scripts.
const TPO_REFERENCE_PROFILE = Object.freeze({
  qmarkRatio: 0.08,
  embeddedRatio: 0.63,
  passiveRatio: 0.11,
  distractorRatio: 0.88,
  negationRatio: 0.2,
  avgAnswerWords: 10.6,
  avgEffectiveChunks: 5.8,
});

/* ---------- Shared embedded question detection ---------- */
/**
 * Returns true if a question's grammar_points indicate an embedded/indirect question.
 * Used by difficultyControl, buildSentenceSchema, and generateBSQuestions.
 */
function isEmbeddedQuestion(grammarPoints) {
  const points = Array.isArray(grammarPoints) ? grammarPoints : [];
  const text = points.map((g) => String(g || "").toLowerCase()).join(" | ");
  return (
    text.includes("embedded") ||
    text.includes("indirect") ||
    text.includes("whether") ||
    /\bif\b/.test(text) ||
    text.includes("curious") ||
    text.includes("wondering") ||
    text.includes("wanted to know") ||
    text.includes("wants to know") ||
    text.includes("needed to know") ||
    text.includes("find out") ||
    text.includes("found out") ||
    text.includes("tell me") ||
    text.includes("do you know") ||
    text.includes("can you tell") ||
    text.includes("asked") ||
    text.includes("understand why") ||
    text.includes("love to know") ||
    text.includes("would love")
  );
}

/**
 * Returns true if a question's grammar_points indicate negation.
 */
function isNegation(grammarPoints) {
  const points = Array.isArray(grammarPoints) ? grammarPoints : [];
  const text = points.map((g) => String(g || "").toLowerCase()).join(" | ");
  return (
    text.includes("negation") ||
    text.includes("negative") ||
    text.includes("not") ||
    text.includes("never") ||
    text.includes("no longer") ||
    text.includes("have no")
  );
}

module.exports = {
  ETS_STYLE_TARGETS,
  ETS_DIFFICULTY_COUNTS_10,
  ETS_DIFFICULTY_RATIO,
  TPO_REFERENCE_PROFILE,
  isEmbeddedQuestion,
  isNegation,
};
