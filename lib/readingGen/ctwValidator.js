/**
 * Validates AI-generated CTW items against ETS profile targets.
 *
 * Goes beyond schema validation — checks ETS flavor compliance:
 * - Word count in range
 * - Sentence count and length
 * - Readability (FK grade)
 * - Blank word quality (mix of function/content words)
 * - Hedging presence
 * - Transition presence
 * - Passive voice presence
 */

const { CTW_PROFILE, ETS_FLAVOR } = require("../readingBank/readingEtsProfile");

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
  "by", "from", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might", "can",
  "it", "its", "this", "that", "these", "those", "they", "them", "their", "he", "she",
  "his", "her", "we", "our", "you", "your", "not", "no", "as", "if", "so", "than",
  "also", "very", "up", "out", "all", "each", "every", "both", "such", "only", "own",
  "into", "over", "after", "before", "between", "through", "during", "without",
  "who", "which", "what", "when", "where", "how", "there",
]);

const HEDGE_WORDS = new Set([
  "may", "might", "could", "possibly", "perhaps", "likely", "unlikely",
  "suggest", "suggests", "appear", "appears", "seem", "seems",
  "tend", "tends", "often", "generally", "typically", "usually",
  "approximately", "roughly", "relatively", "somewhat",
  "potential", "potentially", "probable", "probably",
  "indicate", "indicates",
]);

const CONTRAST_WORDS = new Set([
  "however", "but", "although", "though", "nevertheless", "despite",
  "while", "whereas", "yet", "instead", "rather",
]);

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 2) return 1;
  let count = w.match(/[aeiouy]+/g)?.length || 1;
  if (w.endsWith("e") && !w.endsWith("le")) count--;
  return Math.max(1, count);
}

function fleschKincaid(words, sentCount) {
  if (sentCount === 0 || words.length === 0) return 0;
  const totalSyl = words.reduce((s, w) => s + syllables(w), 0);
  return 0.39 * (words.length / sentCount) + 11.8 * (totalSyl / words.length) - 15.59;
}

/**
 * Validate a CTW item against ETS profile.
 *
 * @param {object} item — processed CTW item from cTestBlanker
 * @returns {{ pass: boolean, errors: string[], warnings: string[] }}
 */
function validateCTWItem(item) {
  const errors = [];
  const warnings = [];

  if (!item || !item.passage) {
    return { pass: false, errors: ["missing passage"], warnings: [] };
  }

  const words = item.passage.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter(Boolean);
  const sentences = item.passage.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 1);
  const wc = words.length;
  const sc = sentences.length;

  // 1. Word count — ETS official sample is 47 words, so minimum is 45
  //    C-test needs enough words for 10 blanks (typically 45+ words suffices)
  if (wc < 45) {
    errors.push(`word_count_critical: ${wc} words (minimum 45 for 10 blanks)`);
  } else if (wc > 120) {
    warnings.push(`word_count_long: ${wc} (target ≤100)`);
  }

  // 2. Sentence count
  if (sc < CTW_PROFILE.sentenceCount.min || sc > CTW_PROFILE.sentenceCount.max) {
    warnings.push(`sentence_count: ${sc} (target ${CTW_PROFILE.sentenceCount.min}-${CTW_PROFILE.sentenceCount.max})`);
  }

  // 3. FK grade
  const fk = fleschKincaid(words, sc);
  if (fk < CTW_PROFILE.fleschKincaidGrade.min - 2 || fk > CTW_PROFILE.fleschKincaidGrade.max + 2) {
    warnings.push(`FK_grade: ${fk.toFixed(1)} (target ${CTW_PROFILE.fleschKincaidGrade.min}-${CTW_PROFILE.fleschKincaidGrade.max})`);
  }

  // 4. Blank quality check
  if (item.blanks && item.blanks.length === 10) {
    const blankWords = item.blanks.map(b => b.original_word.toLowerCase().replace(/[^a-z]/g, ""));
    const functionBlanks = blankWords.filter(w => STOP_WORDS.has(w));
    const contentBlanks = blankWords.filter(w => !STOP_WORDS.has(w));

    // Should have a mix: ~35% function, ~65% content
    const funcRatio = functionBlanks.length / 10;
    if (funcRatio > 0.6) {
      warnings.push(`too_many_function_blanks: ${functionBlanks.length}/10 (target ~35%)`);
    }
    if (funcRatio < 0.1) {
      warnings.push(`too_few_function_blanks: ${functionBlanks.length}/10 (need some easy ones)`);
    }

    // Average blank word length
    const avgBlankLen = blankWords.reduce((s, w) => s + w.length, 0) / 10;
    if (avgBlankLen < 3) {
      warnings.push(`blank_words_too_short: avg ${avgBlankLen.toFixed(1)} chars`);
    }
    if (avgBlankLen > 9) {
      warnings.push(`blank_words_too_long: avg ${avgBlankLen.toFixed(1)} chars`);
    }

    // Check for repeated blank words
    const seen = new Set();
    for (const w of blankWords) {
      if (seen.has(w)) {
        warnings.push(`duplicate_blank_word: "${w}"`);
      }
      seen.add(w);
    }
  } else {
    errors.push(`blank_count: ${item.blanks?.length || 0} (need exactly 10)`);
  }

  // 5. Hedging check — warn only, passage can be post-processed
  const hedgeCount = words.filter(w => HEDGE_WORDS.has(w)).length;
  if (hedgeCount === 0) {
    warnings.push("no_hedging: missing may/might/suggest/appear/tend/often/generally");
  }

  // 6. Contrast/transition check
  const contrastCount = words.filter(w => CONTRAST_WORDS.has(w)).length;
  if (contrastCount === 0) {
    warnings.push("no_contrast_transition: missing however/but/although/while");
  }

  // 7. Passive voice check — warn only
  const passiveMatch = item.passage.match(/\b(?:is|are|was|were|been|being)\s+\w+(?:ed|en|wn|ght|nd|lt|pt|ft|ck|ng)\b/gi);
  if (!passiveMatch || passiveMatch.length === 0) {
    warnings.push("no_passive_voice: missing passive construction");
  }

  // 8. First person check (should not appear)
  if (item.passage.match(/\b(?:I|we|our|my|me)\b/)) {
    errors.push("first_person: ETS academic passages never use I/we/our");
  }

  // 9. Rhetorical question check
  const questionSents = sentences.filter(s => s.trim().endsWith("?"));
  if (questionSents.length > 0) {
    warnings.push("has_question: avoid rhetorical questions in CTW passages");
  }

  // 10. Single-letter fragment count (ambiguity risk)
  if (item.blanks) {
    const singleCharFrags = item.blanks.filter(b => b.displayed_fragment.length === 1);
    if (singleCharFrags.length >= 4) {
      warnings.push(`too_many_single_char_fragments: ${singleCharFrags.length}/10 — high ambiguity risk for test-takers`);
    }
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = { validateCTWItem };
