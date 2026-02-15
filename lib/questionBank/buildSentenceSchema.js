/**
 * Build a Sentence — ETS-aligned schema validation (v2)
 *
 * New schema: chunks (multi-word), prefilled, distractor, grammar_points
 */

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

/**
 * Validate a single question against new ETS schema.
 * Returns { fatal: string[], format: string[], content: string[] }
 */
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
  const chunks = q.chunks.map(c => normalize(c));
  const prefilled = q.prefilled.map(c => normalize(c));
  const distractor = q.distractor ? normalize(q.distractor) : null;

  // [致命] chunks（去掉 distractor）+ prefilled 的所有词 = answer 的所有词
  const chunkWords = [];
  chunks.forEach(c => {
    if (distractor && c === distractor) return;
    words(c).forEach(w => chunkWords.push(w));
  });
  prefilled.forEach(c => words(c).forEach(w => chunkWords.push(w)));
  const chunkWordsSorted = [...chunkWords].sort();
  const answerWordsSorted = [...answerWords].sort();
  if (chunkWordsSorted.length !== answerWordsSorted.length ||
      !chunkWordsSorted.every((w, i) => w === answerWordsSorted[i])) {
    fatal.push("chunks (minus distractor) + prefilled words must equal answer words");
  }

  // [致命] distractor 不在 answer 中
  if (distractor) {
    const distractorW = words(distractor);
    const answerLower = normalize(q.answer).replace(/[.,!?;:]/g, "");
    if (answerLower.includes(distractorW.join(" "))) {
      fatal.push("distractor must not appear in answer");
    }
  }

  // [致命] prefilled_positions 中每个词的位置正确
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

  // [致命] prefilled 的词不在 chunks 中重复出现
  for (const pf of prefilled) {
    if (chunks.includes(pf)) {
      fatal.push(`prefilled "${pf}" must not also appear in chunks`);
    }
  }

  // [格式] 有效 chunks 数 5-7
  const effectiveChunks = chunks.filter(c => c !== distractor);
  if (effectiveChunks.length < 5 || effectiveChunks.length > 7) {
    format.push(`effective chunks count must be 5-7 (got ${effectiveChunks.length})`);
  }

  // [格式] answer 词数 7-13
  if (answerWords.length < 7 || answerWords.length > 13) {
    format.push(`answer word count must be 7-13 (got ${answerWords.length})`);
  }

  // [格式] 每个 chunk ≤ 3 词
  q.chunks.forEach((c, i) => {
    if (words(c).length > 3) {
      format.push(`chunks[${i}]: must be at most 3 words`);
    }
  });

  // [格式] chunks 全小写
  q.chunks.forEach((c, i) => {
    if (c !== c.toLowerCase()) {
      format.push(`chunks[${i}]: must be lowercase`);
    }
  });

  // [格式] has_question_mark 与 answer 末尾标点一致
  const answerTrimmed = q.answer.trim();
  const endsWithQ = answerTrimmed.endsWith("?");
  if (q.has_question_mark !== endsWithQ) {
    format.push("has_question_mark must match answer ending punctuation");
  }

  // [内容] grammar_points 非空
  if (q.grammar_points.length === 0) {
    content.push("grammar_points must not be empty");
  }

  return { fatal, format, content };
}

/**
 * Validate a question set (group of 9 questions).
 * Returns { ok: boolean, errors: string[] }
 */
function validateQuestionSet(questions) {
  const errors = [];
  if (!Array.isArray(questions)) {
    return { ok: false, errors: ["questions must be an array"] };
  }

  const ids = new Set();
  questions.forEach((q, i) => {
    const result = validateQuestion(q);
    const label = `q[${i}]`;
    result.fatal.forEach(e => errors.push(`${label} FATAL: ${e}`));
    result.format.forEach(e => errors.push(`${label} FORMAT: ${e}`));
    result.content.forEach(e => errors.push(`${label} CONTENT: ${e}`));
    if (q && isNonEmptyString(q.id)) {
      if (ids.has(q.id)) errors.push(`${label}: duplicate id "${q.id}"`);
      ids.add(q.id);
    }
  });

  // Set-level distribution checks
  const embeddedQPatterns = ["间接疑问", "embedded question", "indirect question", "whether", "wh-词引导"];
  const passivePatterns = ["被动", "passive"];

  const hasQMark = questions.filter(q => q.has_question_mark === true).length;
  const distractorCount = questions.filter(q => q.distractor != null).length;

  const embeddedCount = questions.filter(q =>
    (q.grammar_points || []).some(gp => embeddedQPatterns.some(p => normalize(gp).includes(p)))
  ).length;
  if (embeddedCount < 5) {
    errors.push(`set: need ≥5 embedded question items (got ${embeddedCount})`);
  }

  if (hasQMark < 6) {
    errors.push(`set: need ≥6 questions with question mark (got ${hasQMark})`);
  }

  if (distractorCount < 2 || distractorCount > 3) {
    errors.push(`set: need 2-3 distractor items (got ${distractorCount})`);
  }

  const passiveCount = questions.filter(q =>
    (q.grammar_points || []).some(gp => passivePatterns.some(p => normalize(gp).includes(p)))
  ).length;
  if (passiveCount < 1) {
    errors.push(`set: need ≥1 passive voice item (got ${passiveCount})`);
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateQuestion,
  validateQuestionSet,
};
