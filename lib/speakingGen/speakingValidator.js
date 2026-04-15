/**
 * Validator for generated Speaking items.
 *
 * Validates both Listen & Repeat sentence sets and Interview question sets.
 */

const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const VALID_CATEGORIES = new Set(["personal", "campus", "academic", "opinion"]);
const VALID_TOPICS = new Set(["campus", "daily", "academic", "mixed", "general"]);

// Simple profanity check — just a small obvious list
const BLOCKED_WORDS = new Set([
  "damn", "hell", "shit", "fuck", "ass", "crap", "bitch", "bastard",
  "dick", "piss", "slut", "whore",
]);

function wc(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function containsBlockedWord(text) {
  const words = text.toLowerCase().split(/\s+/);
  return words.some(w => BLOCKED_WORDS.has(w.replace(/[^a-z]/g, "")));
}

function isProperEnglish(text) {
  // Basic checks: starts with capital, ends with punctuation, uses ASCII
  if (!/^[A-Z"']/.test(text)) return false;
  if (!/[.?!"]$/.test(text.trim())) return false;
  // At least 70% ASCII letters/spaces (catches garbled text)
  const ascii = text.replace(/[^a-zA-Z\s]/g, "").length;
  return ascii / text.length > 0.6;
}

// ── Repeat validation ──

/**
 * Validate a single repeat sentence.
 * @param {object} sentence — { id, sentence, difficulty, word_count }
 * @returns {{ pass: boolean, errors: string[], warnings: string[] }}
 */
function validateRepeatSentence(sentence) {
  const errors = [];
  const warnings = [];

  if (!sentence || typeof sentence !== "object") {
    return { pass: false, errors: ["sentence must be an object"], warnings: [] };
  }

  const text = sentence.sentence || "";
  if (!text || typeof text !== "string" || text.trim().length < 10) {
    errors.push("sentence: must be a non-empty string (min 10 chars)");
    return { pass: false, errors, warnings };
  }

  const words = wc(text);

  // Word count: 8-15
  if (words < 8 || words > 15) {
    errors.push(`word_count: ${words} (need 8-15)`);
  } else if (words < 8) {
    warnings.push(`word_count_low: ${words} words (target 8+)`);
  }

  // Profanity
  if (containsBlockedWord(text)) {
    errors.push("profanity: contains blocked words");
  }

  // Basic English check
  if (!isProperEnglish(text)) {
    warnings.push("format: sentence may have formatting issues (capitalization/punctuation)");
  }

  // Difficulty
  if (sentence.difficulty && !VALID_DIFFICULTIES.has(sentence.difficulty)) {
    warnings.push(`difficulty: "${sentence.difficulty}" not in [easy, medium, hard]`);
  }

  // Difficulty-appropriate length
  if (sentence.difficulty === "easy" && words > 12) {
    warnings.push(`easy_too_long: ${words} words (easy sentences target 8-10)`);
  }
  if (sentence.difficulty === "hard" && words < 10) {
    warnings.push(`hard_too_short: ${words} words (hard sentences target 12-15)`);
  }

  return { pass: errors.length === 0, errors, warnings };
}

/**
 * Validate a repeat set (7 sentences).
 * @param {object} set — { id, topic, sentences: [...] }
 * @returns {{ pass: boolean, errors: string[], warnings: string[] }}
 */
function validateRepeatSet(set) {
  const errors = [];
  const warnings = [];

  if (!set || typeof set !== "object") {
    return { pass: false, errors: ["set must be an object"], warnings: [] };
  }

  if (!set.id || typeof set.id !== "string") {
    errors.push("id: must be a non-empty string");
  }

  const sentences = set.sentences || [];
  if (!Array.isArray(sentences)) {
    errors.push("sentences: must be an array");
    return { pass: false, errors, warnings };
  }

  if (sentences.length !== 7) {
    if (sentences.length < 5) {
      errors.push(`sentences: need 7, got ${sentences.length}`);
    } else {
      warnings.push(`sentences: expected 7, got ${sentences.length}`);
    }
  }

  // Validate each sentence
  let sentenceErrors = 0;
  for (let i = 0; i < sentences.length; i++) {
    const result = validateRepeatSentence(sentences[i]);
    if (!result.pass) {
      sentenceErrors++;
      result.errors.forEach(e => errors.push(`sentence[${i}]: ${e}`));
    }
    result.warnings.forEach(w => warnings.push(`sentence[${i}]: ${w}`));
  }

  // Check difficulty progression
  if (sentences.length >= 5) {
    const diffs = sentences.map(s => s.difficulty);
    const hasDiffProgression = diffs.slice(0, 2).every(d => d === "easy")
      && diffs.slice(2, 5).some(d => d === "medium")
      && diffs.slice(-2).some(d => d === "hard" || d === "medium");
    if (!hasDiffProgression) {
      warnings.push("difficulty_progression: expected easy->medium->hard ordering");
    }
  }

  // Check for duplicate sentences
  const textSet = new Set();
  for (const s of sentences) {
    const norm = (s.sentence || "").toLowerCase().trim();
    if (textSet.has(norm)) {
      errors.push("duplicate: repeated sentence text within set");
    }
    textSet.add(norm);
  }

  return { pass: errors.length === 0, errors, warnings };
}

// ── Interview validation ──

/**
 * Validate a single interview question.
 * @param {object} q — { id, question, category, difficulty }
 * @returns {{ pass: boolean, errors: string[], warnings: string[] }}
 */
function validateInterviewQuestion(q) {
  const errors = [];
  const warnings = [];

  if (!q || typeof q !== "object") {
    return { pass: false, errors: ["question must be an object"], warnings: [] };
  }

  const text = q.question || "";
  if (!text || typeof text !== "string" || text.trim().length < 10) {
    errors.push("question: must be a non-empty string (min 10 chars)");
    return { pass: false, errors, warnings };
  }

  const words = wc(text);

  // Word count: 10-25
  if (words < 10 || words > 30) {
    errors.push(`word_count: ${words} (need 10-25, soft max 30)`);
  } else if (words > 25) {
    warnings.push(`word_count_high: ${words} words (target 10-25)`);
  }

  // Must be a question (ends with ?)
  if (!text.trim().endsWith("?")) {
    // Some questions are phrased as "Describe..." or "Tell me about..."
    const startsWithImperative = /^(Describe|Tell|Explain|Talk|Share|Discuss)/i.test(text.trim());
    if (!startsWithImperative) {
      warnings.push("format: question doesn't end with '?' and doesn't start with imperative verb");
    }
  }

  // Profanity
  if (containsBlockedWord(text)) {
    errors.push("profanity: contains blocked words");
  }

  // Category
  if (q.category && !VALID_CATEGORIES.has(q.category)) {
    warnings.push(`category: "${q.category}" not in [personal, campus, academic, opinion]`);
  }

  return { pass: errors.length === 0, errors, warnings };
}

/**
 * Validate an interview set (4 questions).
 * @param {object} set — { id, topic, questions: [...] }
 * @returns {{ pass: boolean, errors: string[], warnings: string[] }}
 */
function validateInterviewSet(set) {
  const errors = [];
  const warnings = [];

  if (!set || typeof set !== "object") {
    return { pass: false, errors: ["set must be an object"], warnings: [] };
  }

  if (!set.id || typeof set.id !== "string") {
    errors.push("id: must be a non-empty string");
  }

  const questions = set.questions || [];
  if (!Array.isArray(questions)) {
    errors.push("questions: must be an array");
    return { pass: false, errors, warnings };
  }

  if (questions.length !== 4) {
    if (questions.length < 3) {
      errors.push(`questions: need 4, got ${questions.length}`);
    } else {
      warnings.push(`questions: expected 4, got ${questions.length}`);
    }
  }

  // Validate each question
  let qErrors = 0;
  for (let i = 0; i < questions.length; i++) {
    const result = validateInterviewQuestion(questions[i]);
    if (!result.pass) {
      qErrors++;
      result.errors.forEach(e => errors.push(`question[${i}]: ${e}`));
    }
    result.warnings.forEach(w => warnings.push(`question[${i}]: ${w}`));
  }

  // Check category progression
  if (questions.length >= 4) {
    const expected = ["personal", "campus", "academic", "opinion"];
    const actual = questions.map(q => q.category);
    const hasProgression = expected.every((cat, i) => actual[i] === cat);
    if (!hasProgression) {
      warnings.push("category_progression: expected personal->campus->academic->opinion");
    }
  }

  // Check for topic diversity (no duplicate opening words across questions)
  const firstWords = questions.map(q => (q.question || "").split(/\s/)[0]?.toLowerCase());
  const uniqueFirstWords = new Set(firstWords);
  if (uniqueFirstWords.size < Math.min(questions.length, 3)) {
    warnings.push("diversity: multiple questions start with the same word");
  }

  return { pass: errors.length === 0, errors, warnings };
}

/**
 * Validate a batch of sets for diversity.
 * @param {object[]} sets — array of repeat or interview sets
 * @param {"repeat"|"interview"} type
 * @returns {{ warnings: string[] }}
 */
function validateBatch(sets, type) {
  const warnings = [];

  if (type === "repeat") {
    // Check sentence diversity across sets
    const allSentences = new Set();
    for (const set of sets) {
      for (const s of (set.sentences || [])) {
        const norm = (s.sentence || "").toLowerCase().trim();
        if (allSentences.has(norm)) {
          warnings.push(`cross_set_duplicate: "${norm.slice(0, 50)}..." appears in multiple sets`);
        }
        allSentences.add(norm);
      }
    }

    // Topic distribution
    const topics = {};
    sets.forEach(s => { topics[s.topic || "unknown"] = (topics[s.topic || "unknown"] || 0) + 1; });
    const topicStr = Object.entries(topics).map(([k, v]) => `${k}=${v}`).join(", ");
    if (Object.keys(topics).length === 1 && sets.length > 2) {
      warnings.push(`topic_diversity: all sets have the same topic (${topicStr})`);
    }
  }

  if (type === "interview") {
    // Check question diversity across sets
    const allQuestions = new Set();
    for (const set of sets) {
      for (const q of (set.questions || [])) {
        const norm = (q.question || "").toLowerCase().trim();
        if (allQuestions.has(norm)) {
          warnings.push(`cross_set_duplicate: "${norm.slice(0, 50)}..." appears in multiple sets`);
        }
        allQuestions.add(norm);
      }
    }
  }

  return { warnings };
}

module.exports = {
  validateRepeatSentence,
  validateRepeatSet,
  validateInterviewQuestion,
  validateInterviewSet,
  validateBatch,
};
