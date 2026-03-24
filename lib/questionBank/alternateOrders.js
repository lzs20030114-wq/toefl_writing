/**
 * Detect valid alternate chunk orderings for Build a Sentence questions.
 *
 * Conservative approach — only generates alternates we're confident about:
 *  - Time/place adverbial shifts to sentence end
 *  - Time adverb from sentence end to beginning
 *
 * Critical validation: each alternate is built through buildWordSlots and
 * compared against an "expected" clean relocation of the moved chunk.
 * This catches garbling caused by prefilled word misalignment.
 */

const { words, buildWordSlots } = require("./sentenceEngine");

// ---------- time / place patterns ----------

const TIME_WORDS = new Set([
  "morning", "afternoon", "evening", "night", "weekend",
  "week", "month", "year", "semester", "quarter", "time",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

function isFloatableChunk(chunk) {
  const c = chunk.trim().toLowerCase();
  if (/^(yesterday|today|tomorrow|tonight|recently)$/.test(c)) return true;
  const m = c.match(/^(next|last|this|every)\s+(.+)$/);
  if (m) return TIME_WORDS.has(m[2].trim()) || TIME_WORDS.has(m[2].trim().split(/\s+/)[0]);
  return false;
}

function canStartSentence(chunk) {
  return /^(yesterday|today|tomorrow|tonight|last\s|next\s|this\s|every\s)/i.test(chunk.trim());
}

// ---------- clause guards ----------

const RELATIVE_PRONOUNS = new Set(["that", "which", "who", "whom", "whose"]);

function hasRelativePronounBefore(primaryOrder, idx) {
  for (let i = 0; i < idx; i++) {
    const first = primaryOrder[i].toLowerCase().trim().split(/\s+/)[0];
    if (RELATIVE_PRONOUNS.has(first)) return true;
  }
  return false;
}

function hasRelOrContactClause(question) {
  return (question.grammar_points || []).some((gp) => /relative|contact/i.test(gp));
}

function hasEmbeddedClause(question) {
  return (question.grammar_points || []).some((gp) => /embedded/i.test(gp));
}

// ---------- derive primary chunk order from answer ----------

function deriveChunkOrder(question) {
  const answerW = words(question.answer || "").map((w) => w.toLowerCase());

  const prefilledPositions = question.prefilled_positions || {};
  const prefilledSlots = new Set();
  for (const [chunk, pos] of Object.entries(prefilledPositions)) {
    const ws = words(chunk);
    for (let i = 0; i < ws.length; i++) prefilledSlots.add(pos + i);
  }

  const movableWords = answerW.filter((_, i) => !prefilledSlots.has(i));

  const distractor = question.distractor
    ? words(question.distractor).map((w) => w.toLowerCase()).join(" ")
    : null;
  const allChunks = (question.chunks || []).filter((c) => {
    if (!distractor) return true;
    return words(c).map((w) => w.toLowerCase()).join(" ") !== distractor;
  });

  const order = [];
  const used = new Array(allChunks.length).fill(false);
  let wi = 0;

  while (wi < movableWords.length) {
    let matched = false;
    for (let ci = 0; ci < allChunks.length; ci++) {
      if (used[ci]) continue;
      const cw = words(allChunks[ci]).map((w) => w.toLowerCase());
      if (cw.length === 0) continue;
      let ok = true;
      for (let k = 0; k < cw.length; k++) {
        if (wi + k >= movableWords.length || movableWords[wi + k] !== cw[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        order.push(allChunks[ci]);
        used[ci] = true;
        wi += cw.length;
        matched = true;
        break;
      }
    }
    if (!matched) wi++;
  }

  return order;
}

// ---------- sentence building + expected relocation ----------

function buildSentence(question, chunkOrder) {
  const { slots } = buildWordSlots(question, chunkOrder, { lowercase: true });
  return slots.filter(Boolean).join(" ");
}

/**
 * Construct the expected sentence when moving a chunk to the end.
 * Returns null if the moved words can't be found in the primary.
 */
function expectedMoveToEnd(primarySentence, movedChunkText) {
  const movedW = words(movedChunkText).map((w) => w.toLowerCase());
  const pw = primarySentence.split(" ");

  for (let i = 0; i <= pw.length - movedW.length; i++) {
    if (movedW.every((w, j) => pw[i + j] === w)) {
      const rest = [...pw.slice(0, i), ...pw.slice(i + movedW.length)];
      return [...rest, ...movedW].join(" ");
    }
  }
  return null;
}

/**
 * Construct the expected sentence when moving a chunk to the beginning.
 * Searches from the end to find the last occurrence.
 */
function expectedMoveToBeginning(primarySentence, movedChunkText) {
  const movedW = words(movedChunkText).map((w) => w.toLowerCase());
  const pw = primarySentence.split(" ");

  for (let i = pw.length - movedW.length; i >= 0; i--) {
    if (movedW.every((w, j) => pw[i + j] === w)) {
      const rest = [...pw.slice(0, i), ...pw.slice(i + movedW.length)];
      return [...movedW, ...rest].join(" ");
    }
  }
  return null;
}

// ---------- detect alternate orders ----------

function detectAlternateOrders(question) {
  const primaryOrder = deriveChunkOrder(question);
  if (!primaryOrder || primaryOrder.length < 3) return [];

  const primarySentence = buildSentence(question, primaryOrder);
  const results = [];
  const seen = new Set();
  seen.add(primaryOrder.map((c) => c.toLowerCase()).join("|"));

  const relContact = hasRelOrContactClause(question);
  const embedded = hasEmbeddedClause(question);

  function tryAdd(alt, reason) {
    const key = alt.map((c) => c.toLowerCase()).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ order: alt, reason });
  }

  // Strategy 1: move floatable MIDDLE chunk → END
  if (!relContact) {
    for (let i = 0; i < primaryOrder.length - 1; i++) {
      if (!isFloatableChunk(primaryOrder[i])) continue;
      if (hasRelativePronounBefore(primaryOrder, i)) continue;

      const alt = [...primaryOrder];
      const [moved] = alt.splice(i, 1);
      alt.push(moved);

      // Validate: buildWordSlots output must match clean relocation
      const altSentence = buildSentence(question, alt);
      const expected = expectedMoveToEnd(primarySentence, moved);
      if (expected && altSentence === expected && expected !== primarySentence) {
        tryAdd(alt, "adverbial_shift");
      }
    }
  }

  // Strategy 2: move floatable END chunk → BEGINNING
  if (!embedded) {
    const lastIdx = primaryOrder.length - 1;
    const lastChunk = primaryOrder[lastIdx];
    if (
      isFloatableChunk(lastChunk) &&
      canStartSentence(lastChunk) &&
      !hasRelativePronounBefore(primaryOrder, lastIdx)
    ) {
      const alt = [...primaryOrder];
      const moved = alt.pop();
      alt.unshift(moved);

      const altSentence = buildSentence(question, alt);
      const expected = expectedMoveToBeginning(primarySentence, moved);
      if (expected && altSentence === expected && expected !== primarySentence) {
        tryAdd(alt, "adverbial_shift");
      }
    }
  }

  return results;
}

module.exports = { deriveChunkOrder, detectAlternateOrders, isFloatableChunk };
