const { ETS_STYLE_TARGETS, isEmbeddedQuestion, isNegation } = require("./etsProfile");

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalize(s) {
  return String(s || "").trim().toLowerCase();
}

function words(s) {
  return normalize(s)
    .replace(/[.,!?;:]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function validateQuestion(q) {
  const fatal = [];
  const format = [];
  const content = [];

  if (!q || typeof q !== "object" || Array.isArray(q)) {
    return { fatal: ["must be an object"], format: [], content: [] };
  }

  if (!isNonEmptyString(q.id)) fatal.push("id: must be a non-empty string");
  if (!isNonEmptyString(q.prompt)) fatal.push("prompt: must be a non-empty string");
  if (!isNonEmptyString(q.answer)) fatal.push("answer: must be a non-empty string");
  if (!Array.isArray(q.chunks) || q.chunks.length === 0) fatal.push("chunks: must be a non-empty array");
  if (!Array.isArray(q.prefilled)) fatal.push("prefilled: must be an array");
  if (!q.prefilled_positions || typeof q.prefilled_positions !== "object" || Array.isArray(q.prefilled_positions)) {
    fatal.push("prefilled_positions: must be an object");
  }
  if (typeof q.has_question_mark !== "boolean") fatal.push("has_question_mark: must be a boolean");
  if (!Array.isArray(q.grammar_points)) fatal.push("grammar_points: must be an array");

  if (fatal.length > 0) return { fatal, format, content };

  const answerWords = words(q.answer);
  const chunks = q.chunks.map((c) => normalize(c));
  const prefilled = q.prefilled.map((c) => normalize(c));
  const distractor = q.distractor ? normalize(q.distractor) : null;

  const chunkWords = [];
  chunks.forEach((c) => {
    if (distractor && c === distractor) return;
    words(c).forEach((w) => chunkWords.push(w));
  });
  prefilled.forEach((c) => words(c).forEach((w) => chunkWords.push(w)));

  const chunkWordsSorted = [...chunkWords].sort();
  const answerWordsSorted = [...answerWords].sort();
  if (
    chunkWordsSorted.length !== answerWordsSorted.length ||
    !chunkWordsSorted.every((w, i) => w === answerWordsSorted[i])
  ) {
    fatal.push("chunks (minus distractor) + prefilled words must equal answer words");
  }

  if (distractor) {
    const distractorW = words(distractor);
    const answerLower = normalize(q.answer).replace(/[.,!?;:]/g, "");
    if (answerLower.includes(distractorW.join(" "))) {
      fatal.push("distractor must not appear in answer");
    }
  }

  for (const [chunk, pos] of Object.entries(q.prefilled_positions)) {
    if (!Number.isInteger(pos) || pos < 0) {
      fatal.push(`prefilled_positions["${chunk}"]: position must be a non-negative integer`);
      continue;
    }
    const chunkW = words(chunk);
    const slice = answerWords.slice(pos, pos + chunkW.length);
    if (slice.length !== chunkW.length || !slice.every((w, i) => w === chunkW[i])) {
      fatal.push(`prefilled_positions["${chunk}"]: position ${pos} does not match answer`);
    }
  }

  for (const pf of prefilled) {
    if (chunks.includes(pf)) {
      fatal.push(`prefilled "${pf}" must not also appear in chunks`);
    }
  }

  const effectiveChunks = chunks.filter((c) => c !== distractor);
  if (effectiveChunks.length < 5 || effectiveChunks.length > 8) {
    format.push(`effective chunks count must be 5-8 (got ${effectiveChunks.length})`);
  }

  if (answerWords.length < 7 || answerWords.length > 15) {
    format.push(`answer word count must be 7-15 (got ${answerWords.length})`);
  }

  q.chunks.forEach((c, i) => {
    if (words(c).length > 3) format.push(`chunks[${i}]: must be at most 3 words`);
    if (c !== c.toLowerCase()) format.push(`chunks[${i}]: must be lowercase`);
  });

  const endsWithQ = q.answer.trim().endsWith("?");
  if (q.has_question_mark !== endsWithQ) {
    format.push("has_question_mark must match answer ending punctuation");
  }

  if (q.grammar_points.length === 0) {
    content.push("grammar_points must not be empty");
  }

  return { fatal, format, content };
}

function validateQuestionSet(input) {
  const questions = Array.isArray(input)
    ? input
    : input && Array.isArray(input.questions)
      ? input.questions
      : null;
  const errors = [];
  if (!Array.isArray(questions)) {
    return { ok: false, errors: ["questions must be an array"] };
  }

  const ids = new Set();
  questions.forEach((q, i) => {
    const result = validateQuestion(q);
    const label = `q[${i}]`;
    result.fatal.forEach((e) => errors.push(`${label} FATAL: ${e}`));
    result.format.forEach((e) => errors.push(`${label} FORMAT: ${e}`));
    result.content.forEach((e) => errors.push(`${label} CONTENT: ${e}`));
    if (q && isNonEmptyString(q.id)) {
      if (ids.has(q.id)) errors.push(`${label}: duplicate id "${q.id}"`);
      ids.add(q.id);
    }
  });

  const hasQMark = questions.filter((q) => q.has_question_mark === true).length;
  const distractorCount = questions.filter((q) => q.distractor != null).length;
  const embeddedCount = questions.filter((q) => isEmbeddedQuestion(q.grammar_points)).length;

  if (hasQMark < ETS_STYLE_TARGETS.qmarkMin || hasQMark > ETS_STYLE_TARGETS.qmarkMax) {
    errors.push(`set: need ${ETS_STYLE_TARGETS.qmarkMin}-${ETS_STYLE_TARGETS.qmarkMax} questions with question mark (got ${hasQMark})`);
  }
  if (distractorCount < ETS_STYLE_TARGETS.distractorMin || distractorCount > ETS_STYLE_TARGETS.distractorMax) {
    errors.push(`set: need ${ETS_STYLE_TARGETS.distractorMin}-${ETS_STYLE_TARGETS.distractorMax} distractor items (got ${distractorCount})`);
  }
  if (embeddedCount < ETS_STYLE_TARGETS.embeddedMin || embeddedCount > ETS_STYLE_TARGETS.embeddedMax) {
    errors.push(`set: need ${ETS_STYLE_TARGETS.embeddedMin}-${ETS_STYLE_TARGETS.embeddedMax} embedded-question items (got ${embeddedCount})`);
  }
  if (ETS_STYLE_TARGETS.negationMin != null) {
    const negCount = questions.filter((q) => isNegation(q.grammar_points)).length;
    if (negCount < ETS_STYLE_TARGETS.negationMin || negCount > ETS_STYLE_TARGETS.negationMax) {
      errors.push(`set: need ${ETS_STYLE_TARGETS.negationMin}-${ETS_STYLE_TARGETS.negationMax} negation items (got ${negCount})`);
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateQuestion,
  validateQuestionSet,
  DIFFICULTIES: new Set(["easy", "medium", "hard"]),
  validateBuildSentenceBank: validateQuestionSet,
};
