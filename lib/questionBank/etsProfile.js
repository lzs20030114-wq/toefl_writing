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

  // Embedded/indirect question: TPO 63% overall (38/60), but per-set range is 2-8
  // because yesno/statement prompt types produce fewer embedded answers.
  // Lowered from 5 to 3 to match TPO-authentic mixed-prompt-type sets.
  embeddedMin: 3,
  embeddedMax: 9,

  // Negation: TPO 20% (12/60) — often combined with indirect questions
  // Per 10-question set: 2 items is the target (20%), allow up to 3 (30%)
  negationMin: 2,
  negationMax: 3,
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
  // Given word (prefilled) ratio: 52/60 = 87% of questions have a prefilled segment.
  // Per 10-question set: target 8-9 items with prefilled, 1-2 without.
  givenWordRatio: 0.87,
});

/* ---------- Prefilled-detail profile (calibrated from 60 TPO items in tpo_source.md, 2026-05-29) ---------- */
// Replaces the earlier oversimplified "Prefilled is the SUBJECT" rule, which
// missed ~55% of TPO's actual prefilled patterns. Real TPO uses adverb openers,
// preposition phrases, verb phrases, mid-sentence anchors, and multi-segment
// prefilled — not just subject pronouns/NPs.
const PREFILLED_PROFILE = Object.freeze({
  presenceRatio: 0.87,   // 87% items have prefilled, 13% have none (empty array)
  multiSegmentRatio: 0.30, // ~30% of items with prefilled have 2 or more segments

  // Distribution of segment word counts (across all prefilled segments in 60 TPO)
  wordCountRatio: Object.freeze({
    "1": 0.40,  // "I", "She", "yet", "fun"
    "2": 0.33,  // "Some colleagues", "to me", "he tell"
    "3": 0.10,  // "the local superstore"
    "4+": 0.17, // "at this company to", "wanted to know" + adverbial
  }),

  // Distribution of word TYPES (this is what the old calibration got wrong)
  wordTypeRatio: Object.freeze({
    "subject-pronoun": 0.30,   // "I", "He", "She", "They", "We" — single-word subject
    "subject-np":      0.15,   // "The desk", "Some colleagues", "Professor Cho"
    "adverb-opener":   0.10,   // "Unfortunately,", "Yes,", "Yet"
    "prep-phrase":     0.13,   // "to me", "in town", "at this company to", "the local superstore"
    "verb-phrase":     0.13,   // "wanted to know", "found out", "tell"
    "mid-noun-or-adj": 0.13,   // "fun", "weekends", "most", "quickly", "engagement"
    "conjunction-wh":  0.06,   // "when", "why", "what", "about"
  }),

  // Examples for prompt injection, grouped by type — these are real TPO segments
  examples: Object.freeze({
    "subject-pronoun": ["I", "He", "She", "They", "We"],
    "subject-np":      ["The desk", "Some colleagues", "The bookstore", "This coffee", "Professor Cho"],
    "adverb-opener":   ["Unfortunately,", "Yes,", "Yet"],
    "prep-phrase":     ["to me", "in town", "the local superstore", "at this company to", "the post office"],
    "verb-phrase":     ["wanted to know", "found out", "tell", "is"],
    "mid-noun-or-adj": ["fun", "weekends", "most", "quickly", "engagement"],
    "conjunction-wh":  ["when", "why", "what", "about"],
  }),
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
  PREFILLED_PROFILE,
  isEmbeddedQuestion,
  isNegation,
};
