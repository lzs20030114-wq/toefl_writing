/**
 * Build a Sentence ETS-aligned render functions (v2)
 *
 * New logic: answer-based word slots, prefilled positions, auto-capitalize + punctuation.
 */
const { buildWordSlots } = require("./sentenceEngine");

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
  if (!q.answer && Array.isArray(q.answerOrder)) {
    const correctTokens = composeLegacyTokens(q, q.answerOrder);
    const userTokens = composeLegacyTokens(q, Array.isArray(userChunkOrder) ? userChunkOrder : []);
    const hasQMark = (q.responseSuffix || "").trim() === "?" || q.has_question_mark === true;
    return {
      correctSentenceFull: finishSentence(correctTokens, hasQMark),
      userSentenceFull: finishSentence(userTokens, hasQMark),
    };
  }

  const { answerWords, slots } = buildWordSlots(q, userChunkOrder, { lowercase: false });
  const hasQMark = q.has_question_mark === true;

  const correctSentence = finishSentence([...answerWords], hasQMark);
  const userSentence = finishSentence(slots.filter((w) => w), hasQMark);

  return {
    correctSentenceFull: correctSentence,
    userSentenceFull: userSentence,
  };
}

function composeLegacyTokens(q, chunks) {
  const given = q.given ? [String(q.given)] : [];
  const idx = Number.isInteger(q.givenIndex) ? q.givenIndex : 0;
  const left = (chunks || []).slice(0, idx);
  const right = (chunks || []).slice(idx);
  return [...left, ...given, ...right].flatMap((chunk) => {
    const text = typeof chunk === "object" && chunk !== null ? String(chunk.text || chunk) : String(chunk || "");
    return text.split(/\s+/).filter(Boolean);
  });
}

function preserveIPronoun(word) {
  const lower = word.toLowerCase();
  if (lower === "i") return "I";
  if (lower === "i'm") return "I'm";
  if (lower === "i've") return "I've";
  if (lower === "i'll") return "I'll";
  if (lower === "i'd") return "I'd";
  return lower;
}

function finishSentence(wordArray, hasQMark) {
  if (!wordArray || wordArray.length === 0) return "";
  const cleaned = wordArray.map((w) => preserveIPronoun(w));
  cleaned[0] = cleaned[0].charAt(0).toUpperCase() + cleaned[0].slice(1);
  let sentence = cleaned.join(" ");
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
