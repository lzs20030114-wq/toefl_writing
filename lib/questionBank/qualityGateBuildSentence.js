const { renderSentence } = require("./renderSentence");

const PREPOSITIONS = new Set([
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
  "by",
  "through",
  "across",
  "between",
  "against",
  "without",
  "within",
  "around",
]);

const ARTICLES = new Set(["a", "an", "the", "this", "that", "these", "those"]);

const VERBS_NEED_OBJECT = new Set([
  "bring",
  "take",
  "send",
  "give",
  "show",
  "lend",
  "hand",
  "pass",
  "deliver",
  "submit",
  "return",
  "book",
]);

function words(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
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

function isPrepStart(chunk) {
  const ws = words(chunk);
  return ws.length > 0 && PREPOSITIONS.has(ws[0]);
}

function isHalfPrepChunk(chunk) {
  const ws = words(chunk);
  if (ws.length === 0) return false;
  if (!PREPOSITIONS.has(ws[0])) return false;
  if (ws.length === 1) return true;
  return ws.length <= 2 && ARTICLES.has(ws[1]);
}

function isPrepPhrase(chunk) {
  return isPrepStart(chunk) && !isHalfPrepChunk(chunk);
}

function tokenType(t) {
  return t?.type || t?.t || "";
}

function tokenValue(t) {
  return (t?.value || t?.v || "").trim();
}

function getGivenInfo(question) {
  const tokens = Array.isArray(question.promptTokens) ? question.promptTokens : [];
  const idx = tokens.findIndex((t) => tokenType(t) === "given");
  const value = idx >= 0 ? tokenValue(tokens[idx]) : "";
  return { index: idx, value, words: words(value), tokens };
}

function structureHardFails(question) {
  const errors = [];
  const bank = Array.isArray(question.bank) ? question.bank.map((x) => String(x).trim()) : [];
  const answerOrder = Array.isArray(question.answerOrder)
    ? question.answerOrder.map((x) => String(x).trim())
    : [];
  const tokens = Array.isArray(question.promptTokens) ? question.promptTokens : [];
  const given = tokens.filter((t) => tokenType(t) === "given").map(tokenValue);
  const blankCount = tokens.filter((t) => tokenType(t) === "blank").length;

  if (blankCount !== bank.length) {
    errors.push(`blank count (${blankCount}) must equal bank length (${bank.length})`);
  }
  if (given.length !== 1) {
    errors.push("must contain exactly one given chunk");
  }
  if (given.length === 1 && bank.includes(given[0])) {
    errors.push("bank must not contain given chunk");
  }
  if (!sameMembers(answerOrder, bank)) {
    errors.push("answerOrder must be a permutation of bank");
  }

  return errors;
}

function hardFailReasons(question) {
  const reasons = [...structureHardFails(question)];
  const { index: givenIndex, value: givenValue, tokens } = getGivenInfo(question);
  const bank = Array.isArray(question.bank) ? question.bank.map((x) => String(x).trim()) : [];
  const difficulty = String(question.difficulty || "");
  const givenWordCount = words(givenValue).length;
  const rendered = renderSentence(tokens, question.answerOrder || []);

  if (difficulty === "easy" && bank.length !== 4) {
    reasons.push(`easy bank length must be 4 (got ${bank.length})`);
  }
  if (difficulty === "medium" && (bank.length < 5 || bank.length > 6)) {
    reasons.push(`medium bank length must be 5-6 (got ${bank.length})`);
  }
  if (difficulty === "hard" && (bank.length < 6 || bank.length > 7)) {
    reasons.push(`hard bank length must be 6-7 (got ${bank.length})`);
  }
  if (givenWordCount < 1 || givenWordCount > 2) {
    reasons.push(`given chunk must be 1-2 words (got ${givenWordCount})`);
  }

  if (isHalfPrepChunk(givenValue)) {
    reasons.push(`given chunk is an incomplete prepositional fragment: "${givenValue}"`);
  }

  if (isPrepPhrase(givenValue)) {
    const left = givenIndex > 0 ? tokenType(tokens[givenIndex - 1]) : "";
    const right = givenIndex < tokens.length - 1 ? tokenType(tokens[givenIndex + 1]) : "";
    if (left === "blank" && right === "blank") {
      const blankBefore = tokens.slice(0, givenIndex).filter((t) => tokenType(t) === "blank").length - 1;
      const blankAfter = tokens.slice(0, givenIndex).filter((t) => tokenType(t) === "blank").length;
      const beforeChunk = String((question.answerOrder || [])[blankBefore] || "").trim().toLowerCase();
      const afterChunk = String((question.answerOrder || [])[blankAfter] || "").trim().toLowerCase();
      const beforeHead = words(beforeChunk)[0] || "";
      const afterHead = words(afterChunk)[0] || "";
      const objectLead = new Set(["my", "your", "his", "her", "our", "their", "the", "a", "an", "this", "that", "these", "those"]);

      if (VERBS_NEED_OBJECT.has(beforeHead) && objectLead.has(afterHead)) {
        reasons.push("given prepositional phrase splits verb and direct object");
      }
    }

    const ws = words(rendered);
    for (let i = 0; i < ws.length - 5; i += 1) {
      const v = ws[i];
      const prep = ws[i + 1];
      const det = ws[i + 2];
      const maybeObjectLead = ws[i + 4];
      if (
        VERBS_NEED_OBJECT.has(v) &&
        PREPOSITIONS.has(prep) &&
        ARTICLES.has(det) &&
        ARTICLES.has(maybeObjectLead)
      ) {
        reasons.push("detected verb + place phrase + direct object ordering risk");
        break;
      }
    }
  }

  const prepLikeChunks = bank.filter((c) => isPrepStart(c));
  const halfPrepChunks = bank.filter((c) => isHalfPrepChunk(c));
  if (halfPrepChunks.length > 0) {
    reasons.push(`bank contains incomplete prepositional chunk(s): ${halfPrepChunks.join(", ")}`);
  }
  if (prepLikeChunks.length >= 2) {
    reasons.push("bank contains multiple prepositional chunks, creating placement ambiguity");
  }

  if (/\s+[,.!?;:]/.test(rendered)) {
    reasons.push("rendered correct sentence contains space before punctuation");
  }
  if (/\s{2,}/.test(rendered)) {
    reasons.push("rendered correct sentence contains double spaces");
  }

  return [...new Set(reasons)];
}

function warnings(question) {
  const out = [];
  const { index: givenIndex, tokens } = getGivenInfo(question);
  const rendered = renderSentence(tokens, question.answerOrder || []);

  if (givenIndex === 0 || givenIndex === tokens.length - 1) {
    out.push("given chunk is at sentence boundary (start/end)");
  }
  if (!/[.!?]$/.test(rendered)) {
    out.push("correct sentence has no terminal punctuation");
  }

  return out;
}

module.exports = {
  hardFailReasons,
  warnings,
};
