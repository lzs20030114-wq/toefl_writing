function normalizeSentenceParts(parts, { autoCapitalize = true } = {}) {
  let out = "";
  for (let i = 0; i < parts.length; i += 1) {
    const cur = String(parts[i] || "").trim();
    if (!cur) continue;
    if (!out) {
      out = cur;
      continue;
    }

    const noSpaceBefore =
      /^[,.;:!?%)\]}]+$/.test(cur) ||
      /^['"](s|re|ve|d|ll|m|t)\b/i.test(cur) ||
      /^['"][^ ]+$/.test(cur);
    const noSpaceAfterPrev = /[(\[{]$/.test(out);
    out += (noSpaceBefore || noSpaceAfterPrev ? "" : " ") + cur;
  }

  let cleaned = out
    .replace(/\s+([,.;:!?%)\]}])/g, "$1")
    .replace(/([(\[{])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (autoCapitalize && cleaned) {
    cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

function normalizeChunk(v) {
  return String(v || "").trim();
}

function buildResponseSentence(question, order) {
  const q = question && typeof question === "object" ? question : {};
  const given = normalizeChunk(q.given);
  const suffix = normalizeChunk(q.responseSuffix);
  const words = Array.isArray(order) ? order.map(normalizeChunk).filter(Boolean) : [];
  return normalizeSentenceParts([given, ...words, suffix]);
}

function renderResponseSentence(question, userFilledOrder) {
  const q = question && typeof question === "object" ? question : {};
  const correctOrder = Array.isArray(q.answerOrder) ? q.answerOrder : [];
  const userOrder = Array.isArray(userFilledOrder) ? userFilledOrder : correctOrder;

  const correctSentenceFull = buildResponseSentence(q, correctOrder);
  const userSentenceFull = buildResponseSentence(q, userOrder);

  return {
    correctSentenceFull,
    userSentenceFull,
  };
}

module.exports = {
  normalizeSentenceParts,
  renderResponseSentence,
};
