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
      responseSuffix: raw.responseSuffix || (raw.has_question_mark ? "?" : "."),
    };
  }

  const effectiveChunks = getEffectiveChunks(raw).map((c) => String(c || "").trim());
  const answerOrder = deriveChunkOrderFromAnswer(raw, effectiveChunks);
  const prefilledEntries = Object.entries(raw.prefilled_positions || {});
  let given = null;
  let givenIndex = 0;

  if (prefilledEntries.length > 1) {
    throw new Error("multiple prefilled chunks are not supported in runtime slot model");
  }

  if (prefilledEntries.length === 1) {
    given = String(prefilledEntries[0][0] || "").trim();
    givenIndex = deriveGivenIndexFromAnswer(raw.answer, answerOrder, given);
  } else if (Array.isArray(raw.prefilled) && raw.prefilled.length === 1) {
    given = String(raw.prefilled[0] || "").trim();
    givenIndex = deriveGivenIndexFromAnswer(raw.answer, answerOrder, given);
  }

  return {
    ...raw,
    prompt: raw.prompt || raw.context || "",
    answerOrder,
    bank: [...answerOrder],
    given,
    givenIndex,
    responseSuffix: raw.has_question_mark ? "?" : ".",
    grammar_points: Array.isArray(raw.grammar_points) ? raw.grammar_points : [],
  };
}

function composeChunksWithGiven(q, userOrder) {
  const order = Array.isArray(userOrder) ? userOrder : [];
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
  if (q.bank.length !== q.answerOrder.length) {
    throw new Error(`question ${q.id}: bank length (${q.bank.length}) must equal answerOrder length (${q.answerOrder.length})`);
  }
  if (q.given != null) {
    if (!Number.isInteger(q.givenIndex) || q.givenIndex < 0 || q.givenIndex > q.answerOrder.length) {
      throw new Error(`question ${q.id}: givenIndex out of range`);
    }
  }

  const bankSet = new Set(q.bank);
  const answerSet = new Set(q.answerOrder);
  if (bankSet.size !== q.bank.length) throw new Error(`question ${q.id}: bank must not contain duplicates`);
  if (answerSet.size !== q.answerOrder.length) throw new Error(`question ${q.id}: answerOrder must not contain duplicates`);
  if (bankSet.size !== answerSet.size || [...bankSet].some((x) => !answerSet.has(x))) {
    throw new Error(`question ${q.id}: answerOrder must be a permutation of bank`);
  }

  if (q.answer) {
    const rendered = normalizeWord(renderCorrectSentence(q));
    const expected = normalizeWord(q.answer);
    if (rendered !== expected) {
      throw new Error(`question ${q.id}: given/givenIndex/answerOrder do not reconstruct answer`);
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
