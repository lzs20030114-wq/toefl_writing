const { renderResponseSentence } = require("./renderResponseSentence");

const PREP_OR_LINK_START = new Set([
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "from",
  "about",
  "into",
  "over",
  "under",
  "before",
  "after",
  "by",
  "of",
  "as",
  "than",
]);

const ARTICLES = new Set(["a", "an", "the", "this", "that", "these", "those"]);

function words(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function normalize(s) {
  return String(s || "").trim();
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

function isHalfFunctionalStart(chunk) {
  const ws = words(chunk);
  if (ws.length === 0) return false;
  if (!PREP_OR_LINK_START.has(ws[0])) return false;
  if (ws.length === 1) return true;
  if (ws.length === 2 && ARTICLES.has(ws[1])) return true;
  return false;
}

function hardFailReasons(question) {
  const reasons = [];
  const q = question || {};
  const given = normalize(q.given);
  const context = normalize(q.context);
  const bank = Array.isArray(q.bank) ? q.bank.map(normalize) : [];
  const answerOrder = Array.isArray(q.answerOrder) ? q.answerOrder.map(normalize) : [];

  if (context.split(/\s+/).filter(Boolean).length < 5 || !/[?.]$/.test(context)) {
    reasons.push("context must be a natural full sentence (>=5 words, ending with ? or .)");
  }

  if (bank.includes(given)) reasons.push("bank must not contain given chunk");
  if (answerOrder.length !== bank.length) reasons.push("answerOrder length must equal bank length");
  if (!sameMembers(answerOrder, bank)) reasons.push("answerOrder must be a permutation of bank");

  const givenWordCount = words(given).length;
  if (givenWordCount < 1 || givenWordCount > 3) {
    reasons.push(`given must be 1-3 words (got ${givenWordCount})`);
  }
  if (isHalfFunctionalStart(given)) {
    reasons.push(`given chunk is an incomplete functional fragment: "${given}"`);
  }

  const difficulty = String(q.difficulty || "").toLowerCase();
  if (difficulty === "easy" && bank.length !== 4) {
    reasons.push(`easy bank length must be 4 (got ${bank.length})`);
  }
  if (difficulty === "medium" && (bank.length < 5 || bank.length > 6)) {
    reasons.push(`medium bank length must be 5-6 (got ${bank.length})`);
  }
  if (difficulty === "hard" && (bank.length < 6 || bank.length > 7)) {
    reasons.push(`hard bank length must be 6-7 (got ${bank.length})`);
  }

  const prepHalfInBank = bank.filter((c) => isHalfFunctionalStart(c));
  if (prepHalfInBank.length > 0) {
    reasons.push(`bank contains incomplete preposition/link fragment(s): ${prepHalfInBank.join(", ")}`);
  }

  const { correctSentenceFull } = renderResponseSentence(q);
  if (!correctSentenceFull || words(correctSentenceFull).length < 3) {
    reasons.push("correct response sentence is empty or too short");
  }
  if (/\s+[,.!?;:]/.test(correctSentenceFull)) {
    reasons.push("correct response sentence contains spaces before punctuation");
  }
  if (/\s{2,}/.test(correctSentenceFull)) {
    reasons.push("correct response sentence contains double spaces");
  }

  return [...new Set(reasons)];
}

function warnings(question) {
  const out = [];
  const q = question || {};
  const given = normalize(q.given).toLowerCase();
  if (given && /^(to|in|on|at|for|with|from|before|after)\b/.test(given)) {
    out.push("given starts with preposition; verify object placement is natural");
  }

  return out;
}

module.exports = {
  hardFailReasons,
  warnings,
};
