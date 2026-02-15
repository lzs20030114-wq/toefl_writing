function normalizeText(s) {
  return String(s || "").trim();
}

function words(s) {
  return normalizeText(s).replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
}

function normalizeChunkInput(chunk) {
  if (typeof chunk === "object" && chunk !== null) {
    return normalizeText(chunk.text || chunk);
  }
  return normalizeText(chunk);
}

function buildWordSlots(question, userChunks, { lowercase = false } = {}) {
  const q = question && typeof question === "object" ? question : {};
  const answerWords = words(q.answer);
  const totalSlots = answerWords.length;
  const slots = new Array(totalSlots).fill(null);
  const prefilledPositions = q.prefilled_positions && typeof q.prefilled_positions === "object"
    ? q.prefilled_positions
    : {};

  // Place prefilled words first.
  for (const [chunk, pos] of Object.entries(prefilledPositions)) {
    const ws = words(chunk);
    for (let i = 0; i < ws.length && pos + i < totalSlots; i++) {
      slots[pos + i] = lowercase ? ws[i].toLowerCase() : ws[i];
    }
  }

  // Fill remaining slots from user chunk order.
  const sourceChunks = Array.isArray(userChunks) ? userChunks : [];
  const userWords = [];
  sourceChunks.forEach((chunk) => {
    const text = normalizeChunkInput(chunk);
    if (!text) return;
    words(text).forEach((w) => userWords.push(lowercase ? w.toLowerCase() : w));
  });

  let idx = 0;
  for (let i = 0; i < totalSlots; i++) {
    if (slots[i] === null && idx < userWords.length) {
      slots[i] = userWords[idx++];
    }
  }

  return {
    answerWords,
    slots,
  };
}

module.exports = {
  normalizeText,
  words,
  buildWordSlots,
};
