const { ETS_DIFFICULTY_COUNTS_10, ETS_DIFFICULTY_RATIO } = require("./etsProfile");

function normalizeText(v) {
  return String(v || "").toLowerCase().replace(/[.,!?;:]/g, " ").replace(/\s+/g, " ").trim();
}

function splitWords(v) {
  return normalizeText(v).split(" ").filter(Boolean);
}

function hasPattern(list, patterns) {
  const text = (Array.isArray(list) ? list : []).map((x) => String(x || "").toLowerCase()).join(" | ");
  return patterns.some((p) => (p instanceof RegExp ? p.test(text) : text.includes(p)));
}

function estimateQuestionDifficulty(question) {
  const answerWords = splitWords(question?.answer || "").length;
  const chunks = Array.isArray(question?.chunks) ? question.chunks : [];
  const effectiveChunks = chunks.filter((c) => c !== question?.distractor).length;
  const prefilledCount = Array.isArray(question?.prefilled) ? question.prefilled.length : 0;
  const hasDistractor = question?.distractor ? 1 : 0;
  const hasEmbedded = hasPattern(question?.grammar_points, [
    "embedded question",
    "embedded",
    "indirect question",
    "indirect",
    "whether",
    "how many",
    "how long",
    "curious",
    "wondering",
    "wanted to know",
    "find out",
    "tell me",
    "do you know",
    "can you tell",
    /\bif\b/,
  ])
    ? 1
    : 0;
  const hasNegation = hasPattern(question?.grammar_points, [
    "negation",
    "negative",
    "do not",
    "did not",
    "not",
    "never",
    "no ",
  ])
    ? 1
    : 0;
  const hasLongChunk = chunks.some((c) => splitWords(c).length >= 3) ? 1 : 0;

  const score = (
    answerWords * 0.9 +
    effectiveChunks * 0.8 +
    hasDistractor * 1.2 +
    hasEmbedded * 0.6 +
    hasNegation * 0.4 +
    hasLongChunk * 0.6 -
    prefilledCount * 0.3
  );

  // TPO calibration: most items are medium, very few easy
  // TPO items typically have distractor (+1.2) and longer answers,
  // so baseline score is higher than ETS examples
  let bucket = "medium";
  if (score <= 13.0) bucket = "easy";
  if (score >= 16.0) bucket = "hard";

  return {
    bucket,
    score: Number(score.toFixed(2)),
    features: {
      answerWords,
      effectiveChunks,
      prefilledCount,
      hasDistractor: Boolean(hasDistractor),
      hasEmbedded: Boolean(hasEmbedded),
      hasNegation: Boolean(hasNegation),
      hasLongChunk: Boolean(hasLongChunk),
    },
  };
}

function profileQuestionSetDifficulty(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const counts = { easy: 0, medium: 0, hard: 0 };
  const details = [];

  list.forEach((q) => {
    const est = estimateQuestionDifficulty(q || {});
    counts[est.bucket] += 1;
    details.push({ id: q?.id || "(no-id)", ...est });
  });

  const total = list.length || 1;
  const ratios = {
    easy: counts.easy / total,
    medium: counts.medium / total,
    hard: counts.hard / total,
  };

  return { counts, ratios, details, total: list.length };
}

const ETS_2026_TARGET_RATIO = ETS_DIFFICULTY_RATIO;
const ETS_2026_TARGET_COUNTS_10 = ETS_DIFFICULTY_COUNTS_10;

const ETS_2026_RATIO_TOLERANCE = Object.freeze({
  easy: 0.15,
  medium: 0.2,
  hard: 0.15,
});

function evaluateSetDifficultyAgainstTarget(
  questions,
  { target = ETS_2026_TARGET_RATIO, tolerance = ETS_2026_RATIO_TOLERANCE } = {},
) {
  const profile = profileQuestionSetDifficulty(questions);
  const drifts = {
    easy: Math.abs(profile.ratios.easy - target.easy),
    medium: Math.abs(profile.ratios.medium - target.medium),
    hard: Math.abs(profile.ratios.hard - target.hard),
  };
  const l1 = drifts.easy + drifts.medium + drifts.hard;
  const withinTolerance =
    drifts.easy <= tolerance.easy &&
    drifts.medium <= tolerance.medium &&
    drifts.hard <= tolerance.hard;

  return {
    ok: withinTolerance,
    meetsTargetCount10:
      profile.total === 10 &&
      profile.counts.easy >= 0 && profile.counts.easy <= 2 &&
      profile.counts.medium >= 6 && profile.counts.medium <= 8 &&
      profile.counts.hard >= 1 && profile.counts.hard <= 3,
    profile,
    target,
    tolerance,
    drifts,
    l1: Number(l1.toFixed(3)),
  };
}

function formatDifficultyProfile(result) {
  const { profile, target, l1 } = result;
  const pct = (v) => `${Math.round(v * 100)}%`;
  return `easy=${pct(profile.ratios.easy)} (target ${pct(target.easy)}), medium=${pct(profile.ratios.medium)} (target ${pct(target.medium)}), hard=${pct(profile.ratios.hard)} (target ${pct(target.hard)}), L1=${l1.toFixed(3)}`;
}

module.exports = {
  estimateQuestionDifficulty,
  profileQuestionSetDifficulty,
  evaluateSetDifficultyAgainstTarget,
  formatDifficultyProfile,
  ETS_2026_TARGET_RATIO,
  ETS_2026_RATIO_TOLERANCE,
  ETS_2026_TARGET_COUNTS_10,
};
