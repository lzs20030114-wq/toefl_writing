/**
 * Reading Sample Schema Validation
 *
 * Validates collected TOEFL 2026 reading samples across three task types:
 * - Complete the Words (C-test)
 * - Read in Daily Life
 * - Academic Passage
 *
 * Pattern follows lib/questionBank/buildSentenceSchema.js
 */

// --- Enums ---

const VALID_TOPICS = new Set([
  "biology", "environmental_science", "psychology", "history",
  "business", "art", "technology", "geology", "sociology",
  "anthropology", "astronomy", "chemistry", "physics",
  "materials_science", "ecology", "neuroscience", "health_science",
  "arts_and_media", "other",
]);

const VALID_GENRES = new Set([
  "email", "text_message", "notice", "social_media", "menu",
  "bill", "poster", "schedule", "advertisement", "memo",
  "syllabus", "flyer", "chat_log", "other",
]);

const VALID_CTW_DIFFICULTIES = new Set(["easy", "medium", "hard"]);

const VALID_RDL_QUESTION_TYPES = new Set([
  "main_idea", "detail", "inference", "tone", "vocabulary_in_context",
]);

const VALID_AP_QUESTION_TYPES = new Set([
  "main_idea", "factual_detail", "negative_factual",
  "vocabulary_in_context", "inference", "rhetorical_purpose",
  "paragraph_relationship",
]);

const VALID_DISTRACTOR_PATTERNS = new Set([
  "too_narrow", "too_broad", "opposite", "not_mentioned",
  "misquoted", "wrong_detail", "plausible_but_unsupported",
]);

const VALID_ANSWERS = new Set(["A", "B", "C", "D"]);

// --- Helpers ---

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function countWords(text) {
  if (!text || typeof text !== "string") return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// --- Complete the Words ---

function validateCompleteTheWordsItem(item) {
  const fatal = [];
  const format = [];
  const content = [];

  if (!item || typeof item !== "object") {
    return { fatal: ["must be an object"], format: [], content: [] };
  }

  // Required fields
  if (!isNonEmptyString(item.id)) fatal.push("id: must be a non-empty string");
  if (!isNonEmptyString(item.passage)) fatal.push("passage: must be a non-empty string");
  if (!isNonEmptyString(item.first_sentence)) fatal.push("first_sentence: must be a non-empty string");

  if (fatal.length > 0) return { fatal, format, content };

  // Word count
  const wc = countWords(item.passage);
  if (item.word_count != null && typeof item.word_count !== "number") {
    format.push("word_count: must be a number");
  }
  if (wc < 30 || wc > 130) {
    format.push(`passage word count should be ~40-100 (got ${wc})`);
  }

  // Topic
  if (item.topic && !VALID_TOPICS.has(item.topic)) {
    format.push(`topic: "${item.topic}" is not a recognized topic`);
  }

  // Difficulty
  if (item.difficulty && !VALID_CTW_DIFFICULTIES.has(item.difficulty)) {
    format.push(`difficulty: must be easy/medium/hard (got "${item.difficulty}")`);
  }

  // Blanks
  if (!Array.isArray(item.blanks)) {
    fatal.push("blanks: must be an array");
  } else {
    if (item.blanks.length !== 10) {
      format.push(`blanks: must have exactly 10 items (got ${item.blanks.length})`);
    }

    item.blanks.forEach((blank, i) => {
      if (!blank || typeof blank !== "object") {
        fatal.push(`blanks[${i}]: must be an object`);
        return;
      }
      if (!isNonEmptyString(blank.original_word)) {
        fatal.push(`blanks[${i}].original_word: must be a non-empty string`);
      }
      if (!isNonEmptyString(blank.displayed_fragment)) {
        fatal.push(`blanks[${i}].displayed_fragment: must be a non-empty string`);
      }
      if (typeof blank.position !== "number" && typeof blank.position !== "undefined") {
        format.push(`blanks[${i}].position: should be a number`);
      }

      // Verify fragment is a prefix of original word
      if (blank.original_word && blank.displayed_fragment) {
        const orig = blank.original_word.toLowerCase();
        const frag = blank.displayed_fragment.toLowerCase();
        if (!orig.startsWith(frag)) {
          content.push(`blanks[${i}]: fragment "${blank.displayed_fragment}" is not a prefix of "${blank.original_word}"`);
        }
        // C-test rule: roughly half the word should be shown
        const expectedShown = Math.floor(orig.length / 2);
        if (Math.abs(frag.length - expectedShown) > 1) {
          content.push(`blanks[${i}]: fragment length ${frag.length} seems off for word "${blank.original_word}" (expected ~${expectedShown})`);
        }
      }
    });
  }

  // blank_count consistency
  if (item.blank_count != null && Array.isArray(item.blanks) && item.blank_count !== item.blanks.length) {
    format.push(`blank_count (${item.blank_count}) doesn't match blanks array length (${item.blanks.length})`);
  }

  // First sentence should appear in passage
  if (item.passage && item.first_sentence) {
    if (!item.passage.includes(item.first_sentence.trim())) {
      content.push("first_sentence not found in passage text");
    }
  }

  return { fatal, format, content };
}

// --- Read in Daily Life ---

function validateReadInDailyLifeItem(item) {
  const fatal = [];
  const format = [];
  const content = [];

  if (!item || typeof item !== "object") {
    return { fatal: ["must be an object"], format: [], content: [] };
  }

  if (!isNonEmptyString(item.id)) fatal.push("id: must be a non-empty string");
  if (!isNonEmptyString(item.text)) fatal.push("text: must be a non-empty string");

  if (fatal.length > 0) return { fatal, format, content };

  // Word count
  const wc = countWords(item.text);
  if (wc < 10 || wc > 300) {
    format.push(`text word count should be 15-250 (got ${wc})`);
  }

  // Genre
  if (!item.genre) {
    format.push("genre: should be specified");
  } else if (!VALID_GENRES.has(item.genre)) {
    format.push(`genre: "${item.genre}" is not recognized`);
  }

  // Difficulty
  if (item.difficulty && !VALID_CTW_DIFFICULTIES.has(item.difficulty)) {
    format.push(`difficulty: must be easy/medium/hard`);
  }

  // Questions
  if (!Array.isArray(item.questions)) {
    fatal.push("questions: must be an array");
  } else {
    if (item.questions.length < 2 || item.questions.length > 4) {
      format.push(`questions: should have 2-3 items (got ${item.questions.length})`);
    }

    item.questions.forEach((q, i) => {
      validateMCQuestion(q, i, VALID_RDL_QUESTION_TYPES, fatal, format, content, "rdl");
    });
  }

  // question_count consistency
  if (item.question_count != null && Array.isArray(item.questions) && item.question_count !== item.questions.length) {
    format.push(`question_count (${item.question_count}) doesn't match questions length (${item.questions.length})`);
  }

  return { fatal, format, content };
}

// --- Academic Passage ---

function validateAcademicPassageItem(item) {
  const fatal = [];
  const format = [];
  const content = [];

  if (!item || typeof item !== "object") {
    return { fatal: ["must be an object"], format: [], content: [] };
  }

  if (!isNonEmptyString(item.id)) fatal.push("id: must be a non-empty string");
  if (!isNonEmptyString(item.passage)) fatal.push("passage: must be a non-empty string");

  if (fatal.length > 0) return { fatal, format, content };

  // Word count
  const wc = countWords(item.passage);
  if (wc < 100 || wc > 500) {
    format.push(`passage word count should be ~150-400 (got ${wc})`);
  }

  // Paragraphs
  if (!Array.isArray(item.paragraphs)) {
    format.push("paragraphs: should be an array of paragraph strings");
  } else {
    if (item.paragraphs.length < 2 || item.paragraphs.length > 6) {
      format.push(`paragraphs: should have 3-4 items (got ${item.paragraphs.length})`);
    }
    item.paragraphs.forEach((p, i) => {
      if (!isNonEmptyString(p)) {
        format.push(`paragraphs[${i}]: must be a non-empty string`);
      }
    });

    // paragraph_count consistency
    if (item.paragraph_count != null && item.paragraph_count !== item.paragraphs.length) {
      format.push(`paragraph_count (${item.paragraph_count}) doesn't match paragraphs length (${item.paragraphs.length})`);
    }

    // Paragraphs should reconstruct the passage (loosely)
    if (item.passage) {
      const joined = item.paragraphs.join(" ").replace(/\s+/g, " ").trim();
      const passageNorm = item.passage.replace(/\s+/g, " ").trim();
      if (joined.length > 0 && passageNorm.length > 0) {
        // Check first 50 chars match approximately
        const prefix = passageNorm.substring(0, 50);
        if (!joined.startsWith(prefix.substring(0, 30))) {
          content.push("paragraphs text doesn't seem to match passage beginning");
        }
      }
    }
  }

  // Topic
  if (item.topic && !VALID_TOPICS.has(item.topic)) {
    format.push(`topic: "${item.topic}" is not recognized`);
  }

  // Difficulty
  if (item.difficulty && !VALID_CTW_DIFFICULTIES.has(item.difficulty)) {
    format.push(`difficulty: must be easy/medium/hard`);
  }

  // Questions
  if (!Array.isArray(item.questions)) {
    fatal.push("questions: must be an array");
  } else {
    if (item.questions.length !== 5) {
      format.push(`questions: should have exactly 5 items (got ${item.questions.length})`);
    }

    item.questions.forEach((q, i) => {
      validateMCQuestion(q, i, VALID_AP_QUESTION_TYPES, fatal, format, content, "ap");

      // AP-specific: distractor_analysis
      if (q && q.distractor_analysis && typeof q.distractor_analysis === "object") {
        for (const [key, pattern] of Object.entries(q.distractor_analysis)) {
          if (!VALID_ANSWERS.has(key)) {
            format.push(`questions[${i}].distractor_analysis: key "${key}" should be A/B/C/D`);
          }
          if (key === q.correct_answer) {
            format.push(`questions[${i}].distractor_analysis: should not include correct answer "${key}"`);
          }
          if (!VALID_DISTRACTOR_PATTERNS.has(pattern)) {
            format.push(`questions[${i}].distractor_analysis["${key}"]: "${pattern}" is not a recognized pattern`);
          }
        }
      }

      // references_paragraph
      if (q && q.references_paragraph != null) {
        if (typeof q.references_paragraph !== "number" || q.references_paragraph < 0) {
          format.push(`questions[${i}].references_paragraph: must be a non-negative number`);
        } else if (Array.isArray(item.paragraphs) && q.references_paragraph >= item.paragraphs.length) {
          format.push(`questions[${i}].references_paragraph: ${q.references_paragraph} exceeds paragraph count`);
        }
      }
    });
  }

  // question_count consistency
  if (item.question_count != null && Array.isArray(item.questions) && item.question_count !== item.questions.length) {
    format.push(`question_count (${item.question_count}) doesn't match questions length (${item.questions.length})`);
  }

  return { fatal, format, content };
}

// --- Shared MC question validator ---

function validateMCQuestion(q, index, validTypes, fatal, format, content, prefix) {
  if (!q || typeof q !== "object") {
    fatal.push(`questions[${index}]: must be an object`);
    return;
  }

  if (!isNonEmptyString(q.qid)) {
    format.push(`questions[${index}].qid: must be a non-empty string`);
  }

  if (!isNonEmptyString(q.stem)) {
    fatal.push(`questions[${index}].stem: must be a non-empty string`);
  }

  if (q.question_type && !validTypes.has(q.question_type)) {
    format.push(`questions[${index}].question_type: "${q.question_type}" is not recognized`);
  }

  // Options: must have A, B, C, D
  if (!q.options || typeof q.options !== "object") {
    fatal.push(`questions[${index}].options: must be an object with A/B/C/D`);
  } else {
    for (const key of ["A", "B", "C", "D"]) {
      if (!isNonEmptyString(q.options[key])) {
        fatal.push(`questions[${index}].options.${key}: must be a non-empty string`);
      }
    }
  }

  // Correct answer
  if (!VALID_ANSWERS.has(q.correct_answer)) {
    fatal.push(`questions[${index}].correct_answer: must be A/B/C/D (got "${q.correct_answer}")`);
  }
}

// --- File-level validator ---

function validateSampleFile(data, taskType) {
  const errors = [];

  if (!data || typeof data !== "object") {
    return { ok: false, errors: ["file must contain a JSON object"] };
  }

  if (!isNonEmptyString(data.source)) {
    errors.push("source: must be a non-empty string");
  }

  if (!isNonEmptyString(data.copyright_note)) {
    errors.push("copyright_note: must be specified");
  }

  if (!Array.isArray(data.items)) {
    return { ok: false, errors: [...errors, "items: must be an array"] };
  }

  if (data.items.length === 0) {
    return { ok: true, errors: [], warnings: ["items array is empty — no samples to validate"] };
  }

  const validators = {
    completeTheWords: validateCompleteTheWordsItem,
    readInDailyLife: validateReadInDailyLifeItem,
    academicPassage: validateAcademicPassageItem,
  };

  const validate = validators[taskType];
  if (!validate) {
    return { ok: false, errors: [`unknown task type: "${taskType}"`] };
  }

  const ids = new Set();
  data.items.forEach((item, i) => {
    const result = validate(item);
    const label = `items[${i}]${item && item.id ? ` (${item.id})` : ""}`;
    result.fatal.forEach((e) => errors.push(`${label} FATAL: ${e}`));
    result.format.forEach((e) => errors.push(`${label} FORMAT: ${e}`));
    result.content.forEach((e) => errors.push(`${label} CONTENT: ${e}`));

    if (item && isNonEmptyString(item.id)) {
      if (ids.has(item.id)) errors.push(`${label}: duplicate id`);
      ids.add(item.id);
    }
  });

  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateCompleteTheWordsItem,
  validateReadInDailyLifeItem,
  validateAcademicPassageItem,
  validateSampleFile,
  VALID_TOPICS,
  VALID_GENRES,
  VALID_RDL_QUESTION_TYPES,
  VALID_AP_QUESTION_TYPES,
  VALID_DISTRACTOR_PATTERNS,
};
