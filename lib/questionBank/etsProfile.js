/**
 * ETS Build a Sentence — official statistics (70 questions, 7 sets).
 *
 * Single source of truth for all validation gates, difficulty scoring,
 * style checks, and generation prompts.
 *
 * All numbers below are derived from ETS official data analysis.
 */

/* ---------- Set-level style targets (comprehensive set) ---------- */
const ETS_STYLE_TARGETS = Object.freeze({
  // Question-mark ratio: ETS overall 57% question / 43% statement
  // Comprehensive sets (Set6=90%, Set7=80%), allow wide range
  qmarkMin: 4,
  qmarkMax: 8,

  // Distractor: ETS overall ~30% (21/70), comprehensive sets 2-2
  distractorMin: 2,
  distractorMax: 5,

  // Embedded/indirect question: ETS overall 43%, comprehensive 50-80%
  embeddedMin: 2,
  embeddedMax: 7,

  // Passive voice: ETS overall only 4% (3/70) — NOT a hard requirement
  // passiveMin removed: comprehensive sets may have 0 passive items
});

/* ---------- Difficulty distribution (10-question set) ---------- */
// ETS overall: easy 26% / medium 49% / hard 26%
// For 10 questions: 3/5/2 is the closest integer split
const ETS_DIFFICULTY_COUNTS_10 = Object.freeze({
  easy: 3,
  medium: 5,
  hard: 2,
});

const ETS_DIFFICULTY_RATIO = Object.freeze({
  easy: 0.3,
  medium: 0.5,
  hard: 0.2,
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
    text.includes("find out") ||
    text.includes("tell me") ||
    text.includes("do you know") ||
    text.includes("can you tell")
  );
}

module.exports = {
  ETS_STYLE_TARGETS,
  ETS_DIFFICULTY_COUNTS_10,
  ETS_DIFFICULTY_RATIO,
  isEmbeddedQuestion,
};
