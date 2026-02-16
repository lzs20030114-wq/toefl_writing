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

function normalizeRuntimeQuestion(raw) {
  if (!raw || typeof raw !== "object") throw new Error("question must be an object");

  const isLegacy = Array.isArray(raw.answerOrder) && Array.isArray(raw.bank);
  if (isLegacy) {
    return {
      ...raw,
      id: raw.id,
      prompt: raw.prompt || raw.context || "",
      grammar_points: Array.isArray(raw.grammar_points)
        ? raw.grammar_points
        : raw.gp
          ? [raw.gp]
          : [],
      answerOrder: raw.answerOrder.map((c) => String(c || "").trim()),
      bank: raw.bank.map((c) => String(c || "").trim()),
      given: raw.given || null,
      givenIndex: Number.isInteger(raw.givenIndex) ? raw.givenIndex : 0,
      givenSlots: raw.given ? [{ chunk: raw.given, givenIndex: Number.isInteger(raw.givenIndex) ? raw.givenIndex : 0 }] : [],
      responseSuffix: raw.responseSuffix || (raw.has_question_mark ? "?" : "."),
    };
  }

  const effectiveChunks = getEffectiveChunks(raw).map((c) => String(c || "").trim());
  const answerOrder = deriveChunkOrderFromAnswer(raw, effectiveChunks);

  // Collect all prefilled entries
  const prefilledEntries = Object.entries(raw.prefilled_positions || {});
  let prefilledFromArray = [];
  if (prefilledEntries.length === 0 && Array.isArray(raw.prefilled) && raw.prefilled.length > 0) {
    // Fallback: use prefilled array (need to find positions from answer)
    // This path is less reliable; prefer prefilled_positions
    prefilledFromArray = raw.prefilled;
  }

  let givenSlots = [];
  let given = null;
  let givenIndex = 0;

  if (prefilledEntries.length > 0) {
    givenSlots = deriveMultipleGivenIndices(raw.answer, answerOrder, prefilledEntries);
    // For backward compat, set given/givenIndex to first prefilled
    if (givenSlots.length > 0) {
      given = givenSlots[0].chunk;
      givenIndex = givenSlots[0].givenIndex;
    }
  } else if (prefilledFromArray.length > 0) {
    // Single prefilled from array fallback
    given = String(prefilledFromArray[0] || "").trim();
    givenIndex = deriveGivenIndexFromAnswer(raw.answer, answerOrder, given);
    givenSlots = [{ chunk: given, givenIndex }];
  }

  // bank includes distractor (if any) so user sees it as a selectable chunk
  const bank = [...answerOrder];
  if (raw.distractor) {
    bank.push(String(raw.distractor).trim());
  }

  return {
    ...raw,
    prompt: raw.prompt || raw.context || "",
    answerOrder,
    bank,
    given,
    givenIndex,
    givenSlots,
    responseSuffix: raw.has_question_mark ? "?" : ".",
    grammar_points: Array.isArray(raw.grammar_points) ? raw.grammar_points : [],
  };
}

function composeChunksWithGiven(q, userOrder) {
  const order = Array.isArray(userOrder) ? userOrder : [];
  const slots = q?.givenSlots;

  // Multi-given path
  if (Array.isArray(slots) && slots.length > 0) {
    const result = [...order];
    // Insert givens from last to first to preserve indices
    const sorted = [...slots].sort((a, b) => b.givenIndex - a.givenIndex);
    for (const { chunk, givenIndex: gi } of sorted) {
      result.splice(gi, 0, chunk);
    }
    return result;
  }

  // Legacy single-given path
  if (!q?.given) return [...order];
  const gi = Number.isInteger(q.givenIndex) ? q.givenIndex : 0;
  const left = order.slice(0, gi);
  const right = order.slice(gi);
  return [...left, q.given, ...right];
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

  // Validate givenSlots
  const slots = Array.isArray(q.givenSlots) ? q.givenSlots : [];
  for (const { chunk, givenIndex: gi } of slots) {
    if (!Number.isInteger(gi) || gi < 0 || gi > q.answerOrder.length) {
      throw new Error(`question ${q.id}: givenIndex ${gi} out of range for chunk "${chunk}"`);
    }
  }

  // Legacy single-given validation
  if (slots.length === 0 && q.given != null) {
    if (!Number.isInteger(q.givenIndex) || q.givenIndex < 0 || q.givenIndex > q.answerOrder.length) {
      throw new Error(`question ${q.id}: givenIndex out of range`);
    }
  }

  const bankSet = new Set(q.bank);
  const answerSet = new Set(q.answerOrder);
  if (bankSet.size !== q.bank.length) throw new Error(`question ${q.id}: bank must not contain duplicates`);
  if (answerSet.size !== q.answerOrder.length) throw new Error(`question ${q.id}: answerOrder must not contain duplicates`);
  // bank = answerOrder + optional distractor; answerOrder must be a subset of bank
  if ([...answerSet].some((x) => !bankSet.has(x))) {
    throw new Error(`question ${q.id}: answerOrder must be a subset of bank`);
  }
  if (hasDistractor) {
    const distractorInBank = q.bank.some((b) => !answerSet.has(b));
    if (!distractorInBank) throw new Error(`question ${q.id}: distractor not found in bank`);
  }

  if (q.answer) {
    const rendered = normalizeWord(renderCorrectSentence(q));
    const expected = normalizeWord(q.answer);
    if (rendered !== expected) {
      throw new Error(`question ${q.id}: given/givenIndex/answerOrder do not reconstruct answer (got "${rendered}", expected "${expected}")`);
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
};
