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
  // Common concrete words (frequent in real ETS CTW blanks)
  "record", "dancing", "bright", "sky", "trees", "height", "reach",
  "brain", "body", "stress", "deal", "day", "spent", "cycle", "regular",
  "animals", "plants", "light", "land", "rock", "earth", "air",
  "group", "form", "type", "area", "place", "places", "point", "fact",
  "young", "old", "early", "clear", "deep", "strong", "hard",
  "move", "grow", "live", "build", "feel", "seem", "change",
  "known", "used", "made", "found", "seen", "left", "held",
  // Common content words that appear naturally in science/nature passages
  "energy", "heat", "heated", "cold", "warm", "hot", "cool",
  "rain", "snow", "wind", "storm", "weather", "cloud", "clouds",
  "river", "ocean", "lake", "sea", "island", "mountain", "forest",
  "soil", "sand", "stone", "ice", "fire", "smoke", "dust",
  "bird", "birds", "fish", "insect", "insects", "plant", "flower",
  "leaf", "leaves", "root", "roots", "seed", "seeds", "fruit",
  "sun", "moon", "star", "stars", "night", "winter", "summer",
  "spring", "fall", "season", "seasons", "dark", "dry", "wet",
  "heavy", "fast", "slow", "wide", "thick", "thin", "flat",
  "color", "colors", "shape", "shapes", "sound", "sounds",
  "surface", "ground", "bottom", "top", "side", "edge", "wall",
  "way", "ways", "kind", "kinds", "sort", "size", "number",
  "cause", "effect", "system", "pattern", "level", "rate", "range",
  "power", "force", "speed", "weight", "space", "field", "source",
  "begin", "start", "end", "stop", "stay", "run", "hold",
  "carry", "bring", "send", "pass", "push", "pull", "drop",
  "eat", "drink", "feed", "grow", "break", "cut", "mix",
  "cover", "open", "close", "fill", "clean", "block", "store",
  "protect", "survive", "travel", "visit", "hunt", "catch", "gather",
  "occur", "happen", "produce", "release", "absorb", "collect",
  "warm", "cool", "dry", "fresh", "safe", "rich", "poor",
  "local", "natural", "common", "special", "certain", "possible",
  "simple", "basic", "normal", "total", "whole", "main",
  "famous", "ancient", "modern", "popular", "useful", "active",
  "able", "likely", "enough", "several", "certain",
  "today", "later", "ago", "always", "never", "sometimes",
  "together", "away", "back", "inside", "outside", "below", "above",
  // Common transition/linking
  "consequently", "furthermore", "moreover", "additionally",
  "result", "despite", "although",
]);

// Medium-frequency academic words (B2 level — test-takers should know these)
const MEDIUM_WORDS = new Set([
  "structure", "process", "research", "significant", "environment", "complex",
  "fundamental", "species", "mechanism", "evidence", "theory", "function",
  "maintain", "identify", "develop", "establish", "contribute", "influence",
  "suggest", "indicate", "demonstrate", "require", "involve",
  "economic", "cultural", "physical", "chemical", "biological", "geological",
  "essential", "primary", "specific", "particular", "considerable",
  "consequently", "furthermore", "nevertheless", "alternatively",
  "phenomenon", "characteristic", "distribution", "conservation",
  // Common academic-adjacent words that appear in science passages
  "pollution", "temperature", "moisture", "climate", "habitat", "oxygen",
  "mineral", "minerals", "material", "materials", "surface", "resource",
  "resources", "population", "community", "region", "regions",
  "behavior", "survival", "movement", "direction", "distance",
  "majority", "method", "methods", "technique", "approach",
  "observe", "record", "measure", "compare", "reduce", "increase",
  "decrease", "improve", "prevent", "depend", "connect", "separate",
  "creates", "created", "produce", "produced", "absorb", "absorbed",
  "coastline", "coastlines", "volcanic", "tropical", "seasonal",
  "harmful", "valuable", "effective", "traditional", "historical",
  "similar", "separate", "independent", "available", "suitable",
]);

// Common prefixes that unambiguously resolve to one word in context
// (fragment → nearly always the same completion for English learners)
const COMMON_PREFIXES = new Set([
  "thr", "tho", "thr", "peo", "bec", "how", "whi", "alth", "betw",
  "ani", "bri", "acr", "thr", "dur", "wit", "aft", "bef",
  "sho", "cou", "wou", "mi", "th", "fr", "wh", "pe",
]);

// Everything else is considered hard

/**
 * Simple suffix stripping to match inflected forms against word sets.
 * Not a full stemmer — just handles common English inflections.
 */
function getWordForms(word) {
  const forms = [word];
  // -ing → base (absorbing → absorb, heating → heat)
  if (word.endsWith("ing") && word.length > 4) {
    forms.push(word.slice(0, -3));
    forms.push(word.slice(0, -3) + "e"); // creating → create
    // doubling: running → run
    if (word.length > 5 && word[word.length - 4] === word[word.length - 5]) {
      forms.push(word.slice(0, -4));
    }
  }
  // -ed → base (heated → heat, created → create)
  if (word.endsWith("ed") && word.length > 3) {
    forms.push(word.slice(0, -2));
    forms.push(word.slice(0, -1)); // used → use
    if (word.endsWith("ied")) forms.push(word.slice(0, -3) + "y"); // carried → carry
  }
  // -s/-es → base (animals → animal, places → place)
  if (word.endsWith("es") && word.length > 3) {
    forms.push(word.slice(0, -2));
    forms.push(word.slice(0, -1)); // places → place
  } else if (word.endsWith("s") && word.length > 3 && !word.endsWith("ss")) {
    forms.push(word.slice(0, -1));
  }
  // -ly → base (effectively → effective)
  if (word.endsWith("ly") && word.length > 4) {
    forms.push(word.slice(0, -2));
  }
  return forms;
}

/**
 * Check if any form of a word exists in a set.
 */
function wordInSet(word, set) {
  return getWordForms(word).some(f => set.has(f));
}

/**
 * Score a single blank word's difficulty (0 = easiest, 10 = hardest)
 */
function scoreBlank(blank) {
  const word = blank.original_word.toLowerCase().replace(/[^a-z]/g, "");
  const fragRatio = blank.displayed_fragment.length / blank.original_word.length;
  let score = 0;

  // Word frequency category (check inflected forms too)
  if (wordInSet(word, EASY_WORDS)) score += 0;
  else if (wordInSet(word, MEDIUM_WORDS)) score += 3;
  else score += 6; // rare/domain-specific word

  // Word length penalty (longer = harder to spell, but moderate)
  if (word.length <= 4) score += 0;
  else if (word.length <= 6) score += 1;
  else if (word.length <= 9) score += 2;
  else score += 3;

  // Fragment ratio bonus (more shown = easier)
  if (fragRatio >= 0.5) score -= 1;
  else if (fragRatio < 0.35) score += 1;

  // Common prefix bonus: fragments like "thr→through", "peo→people" are
  // unambiguous completions that most learners get right instantly
  const frag = blank.displayed_fragment.toLowerCase();
  if (COMMON_PREFIXES.has(frag)) score -= 1;

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
  if (avgScore <= 2.5 || easyBlanks >= 7) {
    difficulty = "easy";
  } else if (avgScore >= 4.5 || hardBlanks >= 5) {
    difficulty = "hard";
  } else {
    difficulty = "medium";
  }

  return { difficulty, score: +avgScore.toFixed(2), blankScores };
}

module.exports = { estimateDifficulty, scoreBlank, EASY_WORDS, MEDIUM_WORDS, wordInSet };
