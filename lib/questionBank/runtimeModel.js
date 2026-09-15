function normalizeWord(s) {
  return String(s || "").toLowerCase().replace(/[.,!?;:]/g, "").replace(/\s+/g, " ").trim();
}

function splitWords(s) {
  return normalizeWord(s).split(/\s+/).filter(Boolean);
}

function matchesAt(words, index, part) {
  if (!Array.isArray(part) || part.length === 0) return false;
  for (let i = 0; i < part.length; i++) {
    if (words[index + i] !== part[i]) return false;
  }
  return true;
}

function getEffectiveChunks(q) {
  const chunks = Array.isArray(q?.chunks) ? q.chunks : [];
  const distractor = q?.distractor;
  if (!distractor) return chunks;
  return chunks.filter((c) => c !== distractor);
}

function deriveChunkOrderFromAnswer(q, effectiveChunks) {
  const answerWords = splitWords(q?.answer || "");
  if (answerWords.length === 0 || effectiveChunks.length === 0) return [...effectiveChunks];

  const locked = new Set();
  for (const [chunk, pos] of Object.entries(q?.prefilled_positions || {})) {
    const ws = splitWords(chunk);
    for (let i = 0; i < ws.length; i++) locked.add(pos + i);
  }

  const remainingWords = [];
  for (let i = 0; i < answerWords.length; i++) {
    if (!locked.has(i)) remainingWords.push(answerWords[i]);
  }

  const candidates = effectiveChunks.map((chunk) => ({
    chunk,
    words: splitWords(chunk),
    used: false,
  }));

  const ordered = [];
  let wi = 0;
  while (wi < remainingWords.length) {
    const matches = candidates
      .filter((c) => !c.used && c.words.length > 0)
      .filter((c) => matchesAt(remainingWords, wi, c.words))
      .sort((a, b) => b.words.length - a.words.length);

    if (matches.length === 0) return [...effectiveChunks];
    const chosen = matches[0];
    chosen.used = true;
    ordered.push(chosen.chunk);
    wi += chosen.words.length;
  }

  if (ordered.length !== effectiveChunks.length) return [...effectiveChunks];
  return ordered;
}

/**
 * Derive the insertion index of a given chunk within the answerOrder sequence.
 * Walks through answer words matching movable chunks and the given chunk.
 */
function deriveGivenIndexFromAnswer(answer, orderedChunks, givenChunk) {
  const answerWords = splitWords(answer);
  const givenWords = splitWords(givenChunk);
  const movableWords = orderedChunks.map((c) => splitWords(c));

  let wi = 0;
  let mi = 0;
  let inserted = false;
  let givenIndex = -1;

  while (wi < answerWords.length) {
    if (!inserted && matchesAt(answerWords, wi, givenWords)) {
      givenIndex = mi;
      wi += givenWords.length;
      inserted = true;
      continue;
    }
    if (mi < movableWords.length && matchesAt(answerWords, wi, movableWords[mi])) {
      wi += movableWords[mi].length;
      mi += 1;
      continue;
    }
    throw new Error("cannot align given position with answer and answerOrder");
  }

  if (!inserted) throw new Error("given chunk not found in answer");
  return givenIndex;
}

/**
 * Derive insertion indices for multiple prefilled chunks.
 * Returns array of { chunk, givenIndex } sorted by answer position.
 */
function deriveMultipleGivenIndices(answer, orderedChunks, prefilledEntries) {
  if (prefilledEntries.length === 0) return [];
  if (prefilledEntries.length === 1) {
    const chunk = String(prefilledEntries[0][0] || "").trim();
    const idx = deriveGivenIndexFromAnswer(answer, orderedChunks, chunk);
    return [{ chunk, givenIndex: idx }];
  }

  // For multiple prefilled: sort by position in answer, then derive indices
  // by progressively inserting each given into the remaining sequence.
  const sorted = [...prefilledEntries].sort((a, b) => Number(a[1]) - Number(b[1]));

  const answerWords = splitWords(answer);
  const movableWordArrays = orderedChunks.map((c) => splitWords(c));

  // Walk through answer words, matching movable chunks and prefilled chunks
  const result = [];
  let wi = 0;
  let mi = 0;
  let si = 0; // sorted prefilled index

  while (wi < answerWords.length) {
    // Check if current position matches next prefilled chunk
    if (si < sorted.length) {
      const pfChunk = String(sorted[si][0] || "").trim();
      const pfWords = splitWords(pfChunk);
      if (matchesAt(answerWords, wi, pfWords)) {
        result.push({ chunk: pfChunk, givenIndex: mi });
        wi += pfWords.length;
        si += 1;
        continue;
      }
    }
    // Try to match a movable chunk
    if (mi < movableWordArrays.length && matchesAt(answerWords, wi, movableWordArrays[mi])) {
      wi += movableWordArrays[mi].length;
      mi += 1;
      continue;
    }
    throw new Error("cannot align multiple prefilled positions with answer and answerOrder");
  }

  if (result.length !== sorted.length) {
    throw new Error("not all prefilled chunks found in answer");
  }

  return result;
}

const AMBIGUITY_FUNCTION_WORDS = new Set([
  "the", "a", "an", "to", "of", "and", "or", "but", "from", "that", "this", "it",
  "in", "on", "at", "for", "with", "by", "as", "if", "then", "than", "so", "be",
  "is", "are", "was", "were", "am", "do", "does", "did", "have", "has", "had",
  "before", "after", "about", "into", "over", "under", "already", "please",
]);

const AMBIGUITY_PREP_START_WORDS = new Set([
  "to", "in", "on", "at", "for", "with", "from", "about", "into", "over", "under", "before", "after", "by",
]);

/**
 * Heuristic ambiguity check on a runtime question (with answerOrder + bank).
 * Returns true if the chunk set is structurally prone to multiple valid orderings.
 *
 * Scoring (threshold 0.35):
 *   - Duplicate chunks in bank            +0.22 each
 *   - Single function-word chunks beyond 3 +0.05 each
 *   - Prepositional-start chunks beyond 1  +0.12 each
 */
function hasAmbiguousArrangements(rq) {
  const answerOrder = Array.isArray(rq?.answerOrder) ? rq.answerOrder : [];
  const bank = Array.isArray(rq?.bank) ? rq.bank : [];
  if (answerOrder.length > 8) return false;

  const seen = new Map();
  bank.forEach((chunk) => {
    const key = String(chunk || "").toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  const duplicateChunks = [...seen.values()].filter((n) => n > 1).length;

  const functionLike = answerOrder.filter((chunk) => {
    const ws = String(chunk || "").toLowerCase().split(/\s+/).filter(Boolean);
    return ws.length === 1 && AMBIGUITY_FUNCTION_WORDS.has(ws[0]);
  }).length;

  const prepStarts = answerOrder.filter((chunk) => {
    const ws = String(chunk || "").toLowerCase().split(/\s+/).filter(Boolean);
    return ws.length > 0 && AMBIGUITY_PREP_START_WORDS.has(ws[0]);
  }).length;

  const score =
    0.05 +
    duplicateChunks * 0.22 +
    Math.max(0, functionLike - 3) * 0.05 +
    Math.max(0, prepStarts - 1) * 0.12;

  return score > 0.35;
}

function normalizeRuntimeQuestion(raw) {
  if (!raw || typeof raw !== "object") throw new Error("question must be an object");

  const effectiveChunks = getEffectiveChunks(raw).map((c) => String(c || "").trim());
  const answerOrder = deriveChunkOrderFromAnswer(raw, effectiveChunks);
  const prefilledEntries = Object.entries(raw.prefilled_positions || {});

  let givenSlots = [];
  if (prefilledEntries.length > 0) {
    givenSlots = deriveMultipleGivenIndices(raw.answer, answerOrder, prefilledEntries);
  }

  const bank = [...answerOrder];
  if (raw.distractor) {
    bank.push(String(raw.distractor).trim());
  }

  return {
    ...raw,
    prompt: raw.prompt || "",
    answerOrder,
    bank,
    givenSlots,
    responseSuffix: raw.has_question_mark ? "?" : ".",
    grammar_points: Array.isArray(raw.grammar_points) ? raw.grammar_points : [],
  };
}

function composeChunksWithGiven(q, userOrder) {
  const order = Array.isArray(userOrder) ? userOrder : [];
  const slots = q?.givenSlots;

  if (Array.isArray(slots) && slots.length > 0) {
    const result = [...order];
    const sorted = [...slots].sort((a, b) => b.givenIndex - a.givenIndex);
    for (const { chunk, givenIndex: gi } of sorted) {
      result.splice(gi, 0, chunk);
    }
    return result;
  }

  return [...order];
}

function renderCorrectSentence(q) {
  const fullChunks = composeChunksWithGiven(q, q.answerOrder || []);
  const suffix = q.responseSuffix || (q.has_question_mark ? "?" : ".");
  const text = fullChunks.join(" ").replace(/\s+/g, " ").trim();
  return text ? `${text}${/[?.!]$/.test(text) ? "" : suffix}` : "";
}

function validateRuntimeQuestion(q) {
  if (!q?.id) throw new Error("question id is missing");
  if (!Array.isArray(q.bank) || !Array.isArray(q.answerOrder)) {
    throw new Error(`question ${q.id}: bank/answerOrder must be arrays`);
  }
  // bank may contain one extra chunk (the distractor)
  const hasDistractor = q.distractor != null;
  const expectedBankLen = hasDistractor ? q.answerOrder.length + 1 : q.answerOrder.length;
  if (q.bank.length !== expectedBankLen) {
    throw new Error(`question ${q.id}: bank length (${q.bank.length}) must be ${expectedBankLen} (answerOrder=${q.answerOrder.length}${hasDistractor ? " + 1 distractor" : ""})`);
  }

  const slots = Array.isArray(q.givenSlots) ? q.givenSlots : [];
  for (const { chunk, givenIndex: gi } of slots) {
    if (!Number.isInteger(gi) || gi < 0 || gi > q.answerOrder.length) {
      throw new Error(`question ${q.id}: givenIndex ${gi} out of range for chunk "${chunk}"`);
    }
  }

  // 词块**允许重复**：真题里同一个词块真的会出现两次 —— "my phone battery died and I couldn't
  // find my charger" 那一屏就摆着两块 my（实测 2026 真题里 15 道栽在这条老断言上）。
  // 重复块在运行时本来就能跑：拖拽块的身份是下标（useBuildSentenceSession 里 id = `${i}-${j}`），
  // 判分比的是渲染出来的词序（sentenceEngine.buildWordSlots 只用文本、不认身份）。
  // 所以这里按**多重集**判定：answerOrder 每个块的出现次数都不能超过 bank 里的次数。
  const bankCount = new Map();
  for (const b of q.bank) bankCount.set(b, (bankCount.get(b) || 0) + 1);
  const answerCount = new Map();
  for (const a of q.answerOrder) answerCount.set(a, (answerCount.get(a) || 0) + 1);
  for (const [chunk, n] of answerCount) {
    const have = bankCount.get(chunk) || 0;
    if (have < n) {
      throw new Error(`question ${q.id}: answerOrder needs ${n}× "${chunk}" but bank has ${have}`);
    }
  }
  if (hasDistractor) {
    // bank 比 answerOrder 多出来的那一块就是干扰块（多重集之差，重复块也数得对）
    const hasSurplus = [...bankCount.entries()].some(([chunk, n]) => n > (answerCount.get(chunk) || 0));
    if (!hasSurplus) throw new Error(`question ${q.id}: distractor not found in bank`);
  }

  if (q.answer) {
    const rendered = normalizeWord(renderCorrectSentence(q));
    const expected = normalizeWord(q.answer);
    if (rendered !== expected) {
      throw new Error(`question ${q.id}: givenSlots/answerOrder do not reconstruct answer (got "${rendered}", expected "${expected}")`);
    }
  }
}

function prepareQuestions(list, { strictThrow = false } = {}) {
  const out = [];
  const errors = [];
  (Array.isArray(list) ? list : []).forEach((raw) => {
    try {
      const q = normalizeRuntimeQuestion(raw);
      validateRuntimeQuestion(q);
      out.push(q);
    } catch (e) {
      const msg = `题库数据异常（id=${raw?.id || "unknown"}）：${e.message}`;
      errors.push(msg);
      if (strictThrow) throw new Error(msg);
    }
  });
  return { questions: out, errors };
}

module.exports = {
  normalizeWord,
  splitWords,
  normalizeRuntimeQuestion,
  validateRuntimeQuestion,
  composeChunksWithGiven,
  renderCorrectSentence,
  prepareQuestions,
  hasAmbiguousArrangements,
};
