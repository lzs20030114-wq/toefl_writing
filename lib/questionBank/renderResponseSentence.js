/**
 * Build a Sentence — ETS-aligned render functions (v2)
 *
 * New logic: answer-based word slots, prefilled positions, auto-capitalize + punctuation.
 */

function normalize(s) {
  return String(s || "").trim();
}

function words(s) {
  return normalize(s).replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
}

/**
 * Build the full sentence from the user's chunk ordering.
 *
 * 1. Determine total slot count from answer words
 * 2. Lock prefilled words at their positions
 * 3. Fill remaining slots with user chunks (expanded to words) in order
 * 4. Auto-capitalize first word, append ? or .
 */
function renderResponseSentence(question, userChunkOrder, options = {}) {
  const q = question && typeof question === "object" ? question : {};
  const answer = normalize(q.answer);
  const answerWords = words(answer);
  const totalSlots = answerWords.length;
  const hasQMark = q.has_question_mark === true;
  const prefilledPositions = q.prefilled_positions && typeof q.prefilled_positions === "object"
    ? q.prefilled_positions : {};

  // Build correct sentence
  const correctWords = [...answerWords];
  const correctSentence = finishSentence(correctWords, hasQMark);

  // Build user sentence
  const userSlots = new Array(totalSlots).fill(null);

  // Place prefilled words
  for (const [chunk, pos] of Object.entries(prefilledPositions)) {
    const ws = words(chunk);
    for (let i = 0; i < ws.length && pos + i < totalSlots; i++) {
      userSlots[pos + i] = ws[i];
    }
  }

  // Expand user chunks to words and fill remaining slots
  const userChunks = Array.isArray(userChunkOrder) ? userChunkOrder : [];
  const userWords = [];
  userChunks.forEach(c => {
    const text = typeof c === "object" && c !== null ? normalize(c.text || c) : normalize(c);
    if (text) words(text).forEach(w => userWords.push(w));
  });

  let wordIdx = 0;
  for (let i = 0; i < totalSlots; i++) {
    if (userSlots[i] === null && wordIdx < userWords.length) {
      userSlots[i] = userWords[wordIdx++];
    }
  }

  // Fill any remaining nulls with empty string
  for (let i = 0; i < totalSlots; i++) {
    if (userSlots[i] === null) userSlots[i] = "";
  }

  const userSentence = finishSentence(userSlots.filter(w => w), hasQMark);

  return {
    correctSentenceFull: correctSentence,
    userSentenceFull: userSentence,
  };
}

function finishSentence(wordArray, hasQMark) {
  if (!wordArray || wordArray.length === 0) return "";
  const cleaned = wordArray.map(w => w.toLowerCase());
  // Capitalize first word
  cleaned[0] = cleaned[0].charAt(0).toUpperCase() + cleaned[0].slice(1);
  let sentence = cleaned.join(" ");
  // Add punctuation
  const punct = hasQMark ? "?" : ".";
  if (!sentence.endsWith("?") && !sentence.endsWith(".") && !sentence.endsWith("!")) {
    sentence += punct;
  }
  return sentence;
}

module.exports = {
  renderResponseSentence,
  finishSentence,
};
