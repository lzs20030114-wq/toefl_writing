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

function samePositionCount(a, b) {
  const n = Math.min(a.length, b.length);
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if (a[i] === b[i]) count += 1;
  }
  return count;
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
  const givenIndex = q.givenIndex;

  if (context.split(/\s+/).filter(Boolean).length < 5 || !/[?.]$/.test(context)) {
    reasons.push("context must be a natural full sentence (>=5 words, ending with ? or .)");
  }

  if (bank.includes(given)) reasons.push("bank must not contain given chunk");
  if (answerOrder.length !== bank.length) reasons.push("answerOrder length must equal bank length");
  if (!sameMembers(answerOrder, bank)) reasons.push("answerOrder must be a permutation of bank");
  if (!Number.isInteger(givenIndex) || givenIndex < 0 || givenIndex > answerOrder.length) {
    reasons.push("givenIndex must be an integer between 0 and answerOrder.length");
  }
  if (bank.length > 0 && bank.join("||") === answerOrder.join("||")) {
    reasons.push("bank order must not be identical to answerOrder");
  }
  if (bank.length > 0) {
    const samePos = samePositionCount(bank, answerOrder);
    if (samePos >= Math.ceil(bank.length / 2)) {
      reasons.push(
        `bank order is too close to answerOrder (${samePos}/${bank.length} same positions)`
      );
    }
  }

  const givenWordCount = words(given).length;
  if (givenWordCount < 1 || givenWordCount > 3) {
    reasons.push(`given must be 1-3 words (got ${givenWordCount})`);
  }
  if (given.toLowerCase() === "please") {
    reasons.push("given must not be fixed starter token \"Please\"");
  }
  if (isHalfFunctionalStart(given)) {
    reasons.push(`given chunk is an incomplete functional fragment: "${given}"`);
  }
  if (bank.length < 8 || bank.length > 12) {
    reasons.push(`bank length must be 8-12 (got ${bank.length})`);
  }

  const { correctSentenceFull } = renderResponseSentence(q, null, { givenInsertIndex: givenIndex });
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
