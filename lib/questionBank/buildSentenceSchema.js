const DIFFICULTIES = new Set(["easy", "medium", "hard"]);

const BANNED_HALF_PREP_GIVEN = /^(to|in|on|at|for|with|from|about|into|over|under|before|after|by)\s+(a|an|the)$/i;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeChunk(v) {
  return String(v || "").trim();
}

function words(v) {
  return normalizeChunk(v).split(/\s+/).filter(Boolean);
}

function sameMembers(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

function validateBuildSentenceItem(item, index = 0) {
  const errors = [];
  const label = `item[${index}]`;

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return [`${label}: must be an object`];
  }
  if (!isNonEmptyString(item.id)) {
    errors.push(`${label}.id: must be a non-empty string`);
  }
  if (!DIFFICULTIES.has(item.difficulty)) {
    errors.push(`${label}.difficulty: must be one of easy|medium|hard`);
  }
  if (!isNonEmptyString(item.context)) {
    errors.push(`${label}.context: must be a non-empty string`);
  }
  if (item.responseSuffix !== undefined && typeof item.responseSuffix !== "string") {
    errors.push(`${label}.responseSuffix: must be a string when provided`);
  }
  if (!isNonEmptyString(item.given)) {
    errors.push(`${label}.given: must be a non-empty string`);
  }
  if (!Number.isInteger(item.givenIndex) || item.givenIndex < 0) {
    errors.push(`${label}.givenIndex: must be a non-negative integer`);
  }
  if (!Array.isArray(item.bank) || item.bank.length === 0) {
    errors.push(`${label}.bank: must be a non-empty array`);
  }
  if (!Array.isArray(item.answerOrder) || item.answerOrder.length === 0) {
    errors.push(`${label}.answerOrder: must be a non-empty array`);
  }
  if (errors.length > 0) return errors;

  const given = normalizeChunk(item.given);
  const givenWordCount = words(given).length;
  if (givenWordCount < 1 || givenWordCount > 3) {
    errors.push(`${label}.given: must be 1-3 words`);
  }
  if (BANNED_HALF_PREP_GIVEN.test(given)) {
    errors.push(`${label}.given: must not be a half preposition phrase like "to the"`);
  }

  const normalizedBank = item.bank.map((x, i) => {
    if (!isNonEmptyString(x)) {
      errors.push(`${label}.bank[${i}]: must be a non-empty string`);
      return "";
    }
    return normalizeChunk(x);
  });

  if (normalizedBank.length < 4) {
    errors.push(`${label}.bank: length must be >= 4`);
  }
  if (item.difficulty === "easy" && normalizedBank.length !== 4) {
    errors.push(`${label}.bank: easy must have exactly 4 chunks`);
  }
  if (item.difficulty === "medium" && (normalizedBank.length < 5 || normalizedBank.length > 6)) {
    errors.push(`${label}.bank: medium must have 5-6 chunks`);
  }
  if (item.difficulty === "hard" && (normalizedBank.length < 6 || normalizedBank.length > 7)) {
    errors.push(`${label}.bank: hard must have 6-7 chunks`);
  }

  const contextWords = normalizeChunk(item.context).split(/\s+/).filter(Boolean).length;
  if (contextWords < 5 || !/[?.]$/.test(normalizeChunk(item.context))) {
    errors.push(`${label}.context: must be >=5 words and end with ? or .`);
  }

  const uniqueBank = new Set(normalizedBank);
  if (uniqueBank.size !== normalizedBank.length) {
    errors.push(`${label}.bank: must not contain duplicate chunks`);
  }

  if (normalizedBank.includes(given)) {
    errors.push(`${label}.bank: must not contain given chunk`);
  }

  const normalizedOrder = item.answerOrder.map((x, i) => {
    if (!isNonEmptyString(x)) {
      errors.push(`${label}.answerOrder[${i}]: must be a non-empty string`);
      return "";
    }
    return normalizeChunk(x);
  });

  if (normalizedOrder.length !== normalizedBank.length) {
    errors.push(
      `${label}.answerOrder: length (${normalizedOrder.length}) must equal bank length (${normalizedBank.length})`
    );
  }

  if (!sameMembers(normalizedOrder, normalizedBank)) {
    errors.push(`${label}.answerOrder: must be a permutation of bank`);
  }
  if (Number.isInteger(item.givenIndex) && item.givenIndex > normalizedOrder.length) {
    errors.push(`${label}.givenIndex: must be between 0 and answerOrder.length`);
  }

  return errors;
}

function validateBuildSentenceBank(items) {
  if (!Array.isArray(items)) {
    return { ok: false, errors: ["root: must be an array"] };
  }
  const allErrors = [];
  const ids = new Set();
  items.forEach((item, index) => {
    const errs = validateBuildSentenceItem(item, index);
    allErrors.push(...errs);
    if (item && isNonEmptyString(item.id)) {
      if (ids.has(item.id)) {
        allErrors.push(`item[${index}].id: duplicate id "${item.id}"`);
      }
      ids.add(item.id);
    }
  });
  return { ok: allErrors.length === 0, errors: allErrors };
}

module.exports = {
  DIFFICULTIES,
  validateBuildSentenceItem,
  validateBuildSentenceBank,
};
