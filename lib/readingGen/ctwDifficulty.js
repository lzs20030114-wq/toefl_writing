/**
 * CTW Difficulty Estimator — calculates difficulty AFTER blanking.
 *
 * Difficulty in C-test is determined by the blanked words, not the passage.
 * Key factors:
 *   1. Blank word frequency (common words = easier)
 *   2. Blank word length (shorter = easier to complete)
 *   3. Context predictability (function words = easier)
 *   4. Fragment ratio (more letters shown = easier)
 */

// High-frequency words that are easy to guess from context
const EASY_WORDS = new Set([
  // Function words (including short prepositions and conjunctions)
  "the", "and", "but", "for", "from", "with", "that", "this", "these", "those",
  "they", "them", "their", "have", "has", "had", "are", "were", "was", "been",
  "not", "also", "only", "into", "over", "after", "before", "while", "which",
  "when", "where", "however", "although", "because", "since", "therefore",
  "its", "being", "yet", "than", "both", "own", "under", "between", "through",
  "during", "within", "about", "across", "along", "among", "around",
  "if", "or", "nor", "so", "then", "still", "even", "just",
  "to", "in", "on", "at", "by", "of", "as", "an", "be", "do",
  // Common verbs (high frequency, easily guessable from context)
  "is", "can", "may", "could", "would", "should", "must", "will", "might",
  "provide", "include", "create", "become", "remain", "allow", "make",
  "lead", "help", "play", "take", "give", "find", "know", "show",
  "use", "need", "work", "keep", "turn", "come", "go", "get", "set",
  // Common nouns/adjectives (easily guessable)
  "new", "large", "small", "important", "different", "various",
  "many", "more", "most", "other", "such", "each", "some",
  "two", "three", "one", "first", "last", "long", "high",
  "often", "well", "much", "far", "home", "part", "time",
  "food", "water", "life", "world", "years", "people", "human",
  // Common transition/linking
  "consequently", "furthermore", "moreover", "additionally",
  "result", "despite", "although",
]);

// Medium-frequency academic words
const MEDIUM_WORDS = new Set([
  "structure", "process", "research", "significant", "environment", "complex",
  "fundamental", "species", "mechanism", "evidence", "theory", "function",
  "maintain", "identify", "develop", "establish", "contribute", "influence",
  "suggest", "indicate", "demonstrate", "occur", "require", "involve",
  "economic", "cultural", "physical", "chemical", "biological", "geological",
  "essential", "primary", "specific", "particular", "considerable",
  "consequently", "furthermore", "nevertheless", "alternatively",
  "phenomenon", "characteristic", "distribution", "conservation",
]);

// Everything else is considered hard

/**
 * Score a single blank word's difficulty (0 = easiest, 10 = hardest)
 */
function scoreBlank(blank) {
  const word = blank.original_word.toLowerCase().replace(/[^a-z]/g, "");
  const fragRatio = blank.displayed_fragment.length / blank.original_word.length;
  let score = 0;

  // Word frequency category
  if (EASY_WORDS.has(word)) score += 0;
  else if (MEDIUM_WORDS.has(word)) score += 3;
  else score += 6; // rare/domain-specific word

  // Word length penalty (longer = harder to spell, but moderate)
  if (word.length <= 4) score += 0;
  else if (word.length <= 6) score += 1;
  else if (word.length <= 9) score += 2;
  else score += 3;

  // Fragment ratio bonus (more shown = easier)
  if (fragRatio >= 0.5) score -= 1;
  else if (fragRatio < 0.35) score += 1;

  return Math.max(0, Math.min(10, score));
}

/**
 * Estimate overall CTW item difficulty based on its blanks.
 *
 * @param {object} item — processed CTW item with blanks array
 * @returns {{ difficulty: string, score: number, blankScores: number[] }}
 */
function estimateDifficulty(item) {
  if (!item.blanks || item.blanks.length === 0) {
    return { difficulty: "medium", score: 5, blankScores: [] };
  }

  const blankScores = item.blanks.map(scoreBlank);
  const avgScore = blankScores.reduce((s, v) => s + v, 0) / blankScores.length;

  // Count how many blanks are hard (score >= 6)
  const hardBlanks = blankScores.filter(s => s >= 6).length;
  const easyBlanks = blankScores.filter(s => s <= 2).length;

  let difficulty;
  if (avgScore <= 2.0 || easyBlanks >= 7) {
    difficulty = "easy";
  } else if (avgScore >= 4.5 || hardBlanks >= 5) {
    difficulty = "hard";
  } else {
    difficulty = "medium";
  }

  return { difficulty, score: +avgScore.toFixed(2), blankScores };
}

module.exports = { estimateDifficulty, scoreBlank, EASY_WORDS, MEDIUM_WORDS };
