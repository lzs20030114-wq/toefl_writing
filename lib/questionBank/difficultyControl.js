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

function detectAdvancedGrammarSignals(question) {
  const answer = normalizeText(question?.answer || "");
  const grammarPoints = Array.isArray(question?.grammar_points) ? question.grammar_points : [];

  const hasPassive =
    hasPattern(grammarPoints, ["passive voice", "passive", "passive progressive"]) ||
    /\b(am|is|are|was|were|be|been)\s+being\s+\w+(?:ed|en)\b/.test(answer) ||
    /\b(am|is|are|was|were|be|been)\s+(?:scheduled|stored|held|selected|written|built|made|known|given|shown|done|taken|chosen|found)\b/.test(answer);

  const hasPerfect =
    hasPattern(grammarPoints, ["present perfect", "perfect aspect", "past perfect"]) ||
    /\b(have|has)\s+\w+(?:ed|en)\b/.test(answer);

  const hasPastPerfect =
    hasPattern(grammarPoints, ["past perfect"]) ||
    /\bhad\s+had\b/.test(answer) ||
    /\bhad\s+(?:gone|been|done|made|found|seen|taken|chosen|written|driven|known|given|grown|shown|told|left)\b/.test(answer);

  const hasRelativeClause =
    hasPattern(grammarPoints, ["relative clause", "contact clause"]) ||
    /\b(that|which|who|whom)\b/.test(answer) ||
    /\bthe\s+\w+\s+(?:i|you|he|she|we|they)\s+\w+/.test(answer);

  const hasWhom = hasPattern(grammarPoints, ["whom"]) || /\bwhom\b/.test(answer);

  const hasComparativeOrSuperlative =
    hasPattern(grammarPoints, ["comparative", "superlative"]) ||
    /\b(more|most|better|best|worse|worst|less|least)\b/.test(answer);

  const hasQuestionFrame =
    hasPattern(grammarPoints, ["question frame", "interrogative frame", "polite question frame"]) ||
    /^(can you tell me|could you tell me|did he ask you)/.test(answer);

  const hasReporting =
    hasPattern(grammarPoints, [
      "wanted to know",
      "asked",
      "curious about",
      "found out",
      "needed to know",
      "was wondering",
      "wants to know",
      "would love to know",
    ]) ||
    /\b(wanted to know|asked|curious about|found out|needed to know|was wondering|wants to know|would love to know)\b/.test(answer);

  const embeddedHits = (answer.match(/\b(if|whether|what|where|when|why|how|which|who|whom)\b/g) || []).length;
  const hasLayeredEmbedding =
    hasPattern(grammarPoints, ["layered embedding", "double embedding"]) ||
    (hasReporting && embeddedHits >= 1) ||
    embeddedHits >= 2;

  const advancedCount = [
    hasPassive,
    hasPerfect,
    hasPastPerfect,
    hasRelativeClause,
    hasWhom,
    hasComparativeOrSuperlative,
    hasLayeredEmbedding,
  ].filter(Boolean).length;

  return {
    hasPassive,
    hasPerfect,
    hasPastPerfect,
    hasRelativeClause,
    hasWhom,
    hasComparativeOrSuperlative,
    hasQuestionFrame,
    hasReporting,
    hasLayeredEmbedding,
    advancedCount,
  };
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
  const advanced = detectAdvancedGrammarSignals(question);

  const score = (
    answerWords * 0.25 +
    effectiveChunks * 0.2 +
    hasDistractor * 0.5 +
    hasEmbedded * 0.8 +
    hasNegation * 0.2 +
    hasLongChunk * 0.2 +
    advanced.hasPassive * 2.0 +
    advanced.hasPerfect * 1.0 +
    advanced.hasPastPerfect * 1.8 +
    advanced.hasRelativeClause * 1.8 +
    advanced.hasWhom * 2.2 +
    advanced.hasComparativeOrSuperlative * 1.4 +
    advanced.hasQuestionFrame * 0.5 +
    advanced.hasReporting * 0.4 +
    advanced.hasLayeredEmbedding * 1.6 -
    prefilledCount * 0.15
  );

  let bucket = "medium";
  if (
    score <= 4.6 &&
    !hasEmbedded &&
    advanced.advancedCount === 0 &&
    !advanced.hasQuestionFrame &&
    !advanced.hasReporting
  ) {
    bucket = "easy";
  } else if (
    score >= 7.2 &&
    (
      advanced.advancedCount >= 2 ||
      advanced.hasPastPerfect ||
      advanced.hasWhom ||
      (advanced.hasPassive && hasEmbedded) ||
      (advanced.hasRelativeClause && advanced.hasComparativeOrSuperlative)
    )
  ) {
    bucket = "hard";
  }

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
      ...advanced,
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
  detectAdvancedGrammarSignals,
  estimateQuestionDifficulty,
  profileQuestionSetDifficulty,
  evaluateSetDifficultyAgainstTarget,
  formatDifficultyProfile,
  ETS_2026_TARGET_RATIO,
  ETS_2026_RATIO_TOLERANCE,
  ETS_2026_TARGET_COUNTS_10,
};
