/**
 * C-test blanking algorithm for Complete the Words.
 *
 * Applies the standard C-test deletion rule:
 * 1. First sentence is always intact
 * 2. Starting from the 2nd word of the 2nd sentence, every other word is blanked
 * 3. "Blanked" means the second half of the word is removed
 * 4. Even-length words: exactly half removed
 * 5. Odd-length words: larger half removed (floor(len/2) chars shown)
 * 6. 1-letter words (I, a) are skipped in the alternation count
 * 7. Exactly 10 blanks are created
 *
 * This is pure mechanical code — no AI involvement.
 */

/**
 * Split text into sentences (simple heuristic).
 */
function splitSentences(text) {
  // Split on sentence-ending punctuation followed by space or end
  const raw = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  return raw;
}

/**
 * Tokenize a sentence into words, preserving punctuation attached to words.
 * Returns array of { word, clean, index } where clean is lowercase letters only.
 */
function tokenize(sentence) {
  const tokens = sentence.split(/\s+/).filter(Boolean);
  return tokens.map((word, index) => ({
    word,                                    // original with punctuation
    clean: word.replace(/[^a-zA-Z]/g, ""),   // letters only
    index,
  }));
}

/**
 * Compute the displayed fragment for a word.
 * Even length: show first half. Odd length: show floor(len/2).
 *
 * @param {string} word — the original word (letters only)
 * @returns {string} the fragment to display
 */
function computeFragment(word) {
  const len = word.length;
  if (len <= 1) return word; // shouldn't happen, but safety
  const show = Math.floor(len / 2);
  return word.substring(0, show);
}

/**
 * Apply C-test blanking to a passage.
 *
 * @param {string} passage — full passage text
 * @returns {{ blanks: Array, blankedText: string, firstSentence: string, error: string|null }}
 */
function applyBlanking(passage) {
  const sentences = splitSentences(passage);

  if (sentences.length < 2) {
    return { blanks: [], blankedText: passage, firstSentence: passage, error: "Need at least 2 sentences" };
  }

  const firstSentence = sentences[0];

  // Flatten all words from sentence 2 onward with their global positions
  const wordPool = [];
  let globalPos = tokenize(sentences[0]).length; // skip first sentence words

  for (let si = 1; si < sentences.length; si++) {
    const tokens = tokenize(sentences[si]);
    tokens.forEach((t, localIdx) => {
      wordPool.push({
        ...t,
        sentenceIndex: si,
        localIndex: localIdx,
        globalPosition: globalPos + localIdx,
      });
    });
    globalPos += tokens.length;
  }

  // Apply alternating deletion starting from position 1 (2nd word, 0-indexed)
  // Skip 1-letter words in the alternation
  const blanks = [];
  let alternateCounter = 0; // 0 = skip (intact), 1 = blank, alternating

  for (let i = 0; i < wordPool.length && blanks.length < 10; i++) {
    const item = wordPool[i];

    // Skip 1-letter clean words (a, I) — they don't participate in alternation
    if (item.clean.length <= 1) continue;

    // First word of sentence 2 is always intact (position 0 in the pool after first-sentence skip)
    if (i === 0) {
      alternateCounter = 0; // next eligible word starts the alternation
      continue;
    }

    alternateCounter++;

    // Blank every other eligible word (odd alternateCounter = blank)
    if (alternateCounter % 2 === 1) {
      const fragment = computeFragment(item.clean);
      blanks.push({
        position: item.globalPosition,
        original_word: item.word.replace(/[.,;:!?]$/, ""), // strip trailing punct
        displayed_fragment: fragment,
        word_index_in_sentence: item.localIndex,
        sentence_index: item.sentenceIndex,
      });
    }
  }

  if (blanks.length < 10) {
    return {
      blanks,
      blankedText: passage,
      firstSentence,
      error: `Only ${blanks.length} blanks created (need 10). Passage may be too short or have too many 1-letter words.`,
    };
  }

  // Build the blanked display text
  const allTokensBySentence = sentences.map(s => tokenize(s));
  const blankPositions = new Set(blanks.map(b => b.position));

  let currentGlobalPos = 0;
  const displayParts = [];

  for (let si = 0; si < allTokensBySentence.length; si++) {
    const tokens = allTokensBySentence[si];
    const sentParts = [];

    for (const t of tokens) {
      const gp = currentGlobalPos++;
      if (blankPositions.has(gp)) {
        const blank = blanks.find(b => b.position === gp);
        const fragment = blank.displayed_fragment;
        const missing = blank.original_word.length - fragment.length;
        const underscores = "_".repeat(missing);
        // Preserve trailing punctuation from original word
        const trailingPunct = t.word.match(/[.,;:!?]+$/)?.[0] || "";
        sentParts.push(fragment + underscores + trailingPunct);
      } else {
        sentParts.push(t.word);
      }
    }

    displayParts.push(sentParts.join(" "));
  }

  return {
    blanks: blanks.slice(0, 10),
    blankedText: displayParts.join(" "),
    firstSentence,
    error: null,
  };
}

/**
 * Process a generated passage into a complete CTW item.
 *
 * @param {object} raw — { passage, topic, subtopic, difficulty }
 * @param {string} id — item ID
 * @returns {{ item: object|null, error: string|null }}
 */
function processPassage(raw, id) {
  const { passage, topic, subtopic, difficulty } = raw;

  if (!passage || typeof passage !== "string") {
    return { item: null, error: "passage must be a non-empty string" };
  }

  const result = applyBlanking(passage);

  if (result.error) {
    return { item: null, error: result.error };
  }

  const wordCount = passage.trim().split(/\s+/).length;

  return {
    item: {
      id,
      passage,
      word_count: wordCount,
      topic: topic || "other",
      subtopic: subtopic || "",
      blanks: result.blanks,
      blank_count: result.blanks.length,
      first_sentence: result.firstSentence,
      difficulty: difficulty || "medium",
      blanked_text: result.blankedText,
    },
    error: null,
  };
}

module.exports = { applyBlanking, processPassage, computeFragment, splitSentences };
