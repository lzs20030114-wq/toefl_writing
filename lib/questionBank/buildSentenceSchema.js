const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const TOKEN_TYPES = new Set(["text", "blank", "given"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
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
  if (!Array.isArray(item.promptTokens) || item.promptTokens.length === 0) {
    errors.push(`${label}.promptTokens: must be a non-empty array`);
  }
  if (!Array.isArray(item.bank) || item.bank.length === 0) {
    errors.push(`${label}.bank: must be a non-empty array`);
  }
  if (!Array.isArray(item.answerOrder) || item.answerOrder.length === 0) {
    errors.push(`${label}.answerOrder: must be a non-empty array`);
  }
  if (errors.length > 0) return errors;

  const givenChunks = [];
  let blankCount = 0;
  item.promptTokens.forEach((token, tokenIndex) => {
    if (!token || typeof token !== "object" || Array.isArray(token)) {
      errors.push(`${label}.promptTokens[${tokenIndex}]: must be an object`);
      return;
    }
    if (!TOKEN_TYPES.has(token.type)) {
      errors.push(`${label}.promptTokens[${tokenIndex}].type: invalid type`);
      return;
    }
    if (token.type === "blank") {
      blankCount += 1;
      return;
    }
    if (!isNonEmptyString(token.value)) {
      errors.push(`${label}.promptTokens[${tokenIndex}].value: required for text/given`);
      return;
    }
    if (token.type === "given") {
      givenChunks.push(token.value.trim());
    }
  });

  if (givenChunks.length !== 1) {
    errors.push(`${label}.promptTokens: must contain exactly one given chunk`);
  }

  const normalizedBank = item.bank.map((x, i) => {
    if (!isNonEmptyString(x)) {
      errors.push(`${label}.bank[${i}]: must be a non-empty string`);
      return "";
    }
    return x.trim();
  });

  const uniqueBank = new Set(normalizedBank);
  if (uniqueBank.size !== normalizedBank.length) {
    errors.push(`${label}.bank: must not contain duplicate chunks`);
  }

  if (blankCount !== normalizedBank.length) {
    errors.push(
      `${label}: blank count (${blankCount}) must equal bank length (${normalizedBank.length})`
    );
  }

  if (givenChunks.length === 1) {
    const given = givenChunks[0];
    if (normalizedBank.includes(given)) {
      errors.push(`${label}.bank: must not contain the given chunk`);
    }
  }

  const normalizedOrder = item.answerOrder.map((x, i) => {
    if (!isNonEmptyString(x)) {
      errors.push(`${label}.answerOrder[${i}]: must be a non-empty string`);
      return "";
    }
    return x.trim();
  });

  if (!sameMembers(normalizedOrder, normalizedBank)) {
    errors.push(`${label}.answerOrder: must be a permutation of bank`);
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

