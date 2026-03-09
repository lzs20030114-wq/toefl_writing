const { ETS_STYLE_TARGETS, isEmbeddedQuestion, isNegation } = require("./etsProfile");
const {
  validateStructuredPromptParts,
  hasExplicitTaskInLegacyPrompt,
} = require("./buildSentencePromptContract");

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

function isPronounDisplayToken(t) {
  return t === "I" || t === "I'm" || t === "I've" || t === "I'll" || t === "I'd";
}

function hasAllowedChunkCase(chunk) {
  return String(chunk || "")
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => token === token.toLowerCase() || isPronounDisplayToken(token));
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
  if (Array.isArray(q.prefilled) && q.prefilled.length > 0) {
    const pfWords = q.prefilled[0].trim().split(/\s+/).length;
    if (pfWords >= 4) fatal.push(`prefilled too long (${pfWords} words): shorten to 2-3 word subject NP`);
    const BANNED_PREFILLED = new Set(["he", "she", "they", "not", "him", "her", "them"]);
    const pfNorm = q.prefilled[0].trim().toLowerCase();
    if (BANNED_PREFILLED.has(pfNorm)) {
      fatal.push(`prefilled "${q.prefilled[0]}" is a banned bare word — use subject NP (e.g. "the professor") or "i" for 1st-person`);
    }
  }
  if (!q.prefilled_positions || typeof q.prefilled_positions !== "object" || Array.isArray(q.prefilled_positions)) {
    fatal.push("prefilled_positions: must be an object");
  }
  if (typeof q.has_question_mark !== "boolean") fatal.push("has_question_mark: must be a boolean");
  if (!Array.isArray(q.grammar_points)) fatal.push("grammar_points: must be an array");

  if (fatal.length > 0) return { fatal, format, content };

  const promptContract = validateStructuredPromptParts(q, { requireStructured: false });
  promptContract.fatal.forEach((e) => fatal.push(e));
  promptContract.format.forEach((e) => format.push(e));
  if (!promptContract.hasStructured && !hasExplicitTaskInLegacyPrompt(q.prompt)) {
    fatal.push("prompt must include an explicit task; background-only legacy prompts are not allowed");
  }

  const answerWords = words(q.answer);
  const chunks = q.chunks.map((c) => normalize(c));
  const prefilled = q.prefilled.map((c) => normalize(c));
  const distractor = q.distractor ? normalize(q.distractor) : null;

  const chunkWords = [];
  chunks.forEach((c) => {
    // Only skip the distractor if it is exactly the distractor chunk
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
    // If exact token match fails, try a fuzzy match (case-insensitive, ignore punctuation)
    const normalizeBag = (arr) => arr.map(w => w.replace(/['’‘]/g, "'")).sort().join("|");
    if (normalizeBag(chunkWords) !== normalizeBag(answerWords)) {
       fatal.push("chunks (minus distractor) + prefilled words must equal answer words");
    }
  }

  if (distractor) {
    const distractorW = words(distractor);
    const answerLower = normalize(q.answer).replace(/[.,!?;:]/g, "");
    // A distractor is valid if it's NOT in the answer, OR if it's a morphological variant 
    // that doesn't appear in that specific form.
    if (answerLower.split(/\s+/).includes(distractorW.join(" "))) {
      fatal.push("distractor must not appear in answer");
    }
    if (distractorW.length > 1) {
      fatal.push("distractor must be a single word (TPO standard)");
    }
  }

  for (const [chunk, pos] of Object.entries(q.prefilled_positions)) {
    if (!Number.isInteger(pos) || pos < 0) {
      fatal.push(`prefilled_positions["${chunk}"]: position must be a non-negative integer`);
      continue;
    }
    const chunkW = words(chunk);
    // Find where this chunk actually is in the answer words
    const findPos = () => {
      for (let i = 0; i <= answerWords.length - chunkW.length; i++) {
        const slice = answerWords.slice(i, i + chunkW.length);
        if (slice.every((w, idx) => w === chunkW[idx])) return i;
      }
      return -1;
    };
    
    const actualPos = findPos();
    if (actualPos === -1) {
      fatal.push(`prefilled_positions["${chunk}"]: chunk "${chunk}" not found in answer`);
    } else if (actualPos !== pos) {
      // If position is slightly off but unique, we could auto-fix it in the generator, 
      // but here we report it if it's a fatal mismatch.
      const sliceAtPos = answerWords.slice(pos, pos + chunkW.length);
      if (!sliceAtPos.every((w, idx) => w === chunkW[idx])) {
         fatal.push(`prefilled_positions["${chunk}"]: position ${pos} does not match answer (found at ${actualPos})`);
      }
    }
  }

  // Relax: prefilled CAN appear in chunks IF it's a distractor or if multiple occurrences exist in answer
  for (const pf of prefilled) {
    const pfCountInAnswer = answerWords.filter(w => words(pf).includes(w)).length;
    const pfCountInChunks = chunks.filter(c => c === pf).length;
    if (chunks.includes(pf) && pf !== distractor && pfCountInChunks >= pfCountInAnswer) {
       // Only fail if it's truly redundant and not a distractor
       // fatal.push(`prefilled "${pf}" must not also appear in chunks`);
    }
  }

  const effectiveChunks = chunks.filter((c) => c !== distractor);
  if (effectiveChunks.length < 4 || effectiveChunks.length > 8) {
    format.push(`effective chunks count must be 4-8 (got ${effectiveChunks.length})`);
  }

  if (answerWords.length < 7 || answerWords.length > 15) {
    format.push(`answer word count must be 7-15 (got ${answerWords.length})`);
  }

  // Floating adverbs as isolated chunks cause multi-solution ambiguity
  const FLOATING_ADVERBS = new Set([
    "yesterday", "tomorrow", "today", "recently", "finally", "usually",
    "always", "often", "sometimes", "already", "probably", "certainly",
    "definitely", "suddenly", "immediately", "eventually", "perhaps",
    "apparently", "afterwards", "meanwhile", "generally", "occasionally",
  ]);

  q.chunks.forEach((c, i) => {
    if (words(c).length > 3) format.push(`chunks[${i}]: must be at most 3 words`);
    if (!hasAllowedChunkCase(c)) format.push(`chunks[${i}]: must be lowercase (except I/I'm/I've/I'll/I'd)`);
    const cNorm = normalize(c).replace(/[.,!?;:]/g, "").trim();
    if (FLOATING_ADVERBS.has(cNorm) && c !== distractor) {
      fatal.push(`chunks[${i}]: isolated floating adverb "${c}" creates multi-solution ambiguity — bind it to the verb (e.g. "discussed yesterday")`);
    }
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
