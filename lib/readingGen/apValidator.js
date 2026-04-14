/**
 * Validates AI-generated AP (Academic Passage) items against ETS profile.
 *
 * Three-level validation:
 * 1. Schema — required fields, types, ranges
 * 2. Profile — ETS flavor compliance (hedging, passive, transitions)
 * 3. Quality — distractor balance, option parallelism, answer position
 */

const { AP_PROFILE, ETS_FLAVOR } = require("../readingBank/readingEtsProfile");

const VALID_QUESTION_TYPES = new Set([
  "main_idea", "factual_detail", "negative_factual",
  "vocabulary_in_context", "inference", "rhetorical_purpose",
  "paragraph_relationship",
]);

const VALID_ANSWERS = new Set(["A", "B", "C", "D"]);

const HEDGE_WORDS = new Set([
  "may", "might", "could", "possibly", "perhaps", "likely",
  "suggest", "suggests", "appear", "appears", "seem", "seems",
  "tend", "tends", "often", "generally", "typically", "usually",
  "indicate", "indicates", "probably",
]);

const CONTRAST_WORDS = new Set([
  "however", "but", "although", "though", "nevertheless", "despite",
  "while", "whereas", "yet", "instead", "rather",
]);

function wc(text) { return text.trim().split(/\s+/).filter(Boolean).length; }

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
 * Validate a single AP item.
 * @returns {{ pass: boolean, errors: string[], warnings: string[] }}
 */
function validateAPItem(item) {
  const errors = [];
  const warnings = [];

  if (!item || typeof item !== "object") {
    return { pass: false, errors: ["item must be an object"], warnings: [] };
  }

  // ── 1. Schema ──

  if (!item.passage || typeof item.passage !== "string" || item.passage.trim().length < 50) {
    errors.push("passage: must be a non-empty string (min 50 chars)");
    return { pass: false, errors, warnings };
  }

  const passageWc = wc(item.passage);
  if (passageWc < 120 || passageWc > 450) {
    errors.push(`passage_length: ${passageWc} words (need 120-450)`);
  }

  if (!Array.isArray(item.paragraphs) || item.paragraphs.length < 2 || item.paragraphs.length > 6) {
    warnings.push(`paragraphs: should have 2-5 items (got ${item.paragraphs?.length || 0})`);
  }

  if (!Array.isArray(item.questions)) {
    errors.push("questions: must be an array");
    return { pass: false, errors, warnings };
  }

  if (item.questions.length !== 5) {
    errors.push(`question_count: must be exactly 5 (got ${item.questions.length})`);
  }

  // Validate each question
  for (let i = 0; i < item.questions.length; i++) {
    const q = item.questions[i];
    const label = `Q${i + 1}`;

    if (!q || typeof q !== "object") {
      errors.push(`${label}: must be an object`);
      continue;
    }

    if (!q.stem || typeof q.stem !== "string" || q.stem.trim().length < 5) {
      errors.push(`${label}: stem must be a non-empty string`);
    }

    if (q.question_type && !VALID_QUESTION_TYPES.has(q.question_type)) {
      warnings.push(`${label}: question_type "${q.question_type}" not recognized`);
    }

    if (!q.options || typeof q.options !== "object") {
      errors.push(`${label}: options must be an object with A/B/C/D`);
      continue;
    }
    for (const key of ["A", "B", "C", "D"]) {
      if (!q.options[key] || typeof q.options[key] !== "string" || q.options[key].trim().length === 0) {
        errors.push(`${label}.options.${key}: must be a non-empty string`);
      }
    }

    if (!VALID_ANSWERS.has(q.correct_answer)) {
      errors.push(`${label}: correct_answer must be A/B/C/D (got "${q.correct_answer}")`);
    }
  }

  if (errors.length > 0) return { pass: false, errors, warnings };

  // ── 2. Profile (ETS flavor) ──

  const words = item.passage.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter(Boolean);
  const sentences = item.passage.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 1);

  // Hedging
  if (!words.some(w => HEDGE_WORDS.has(w))) {
    warnings.push("no_hedging: missing may/might/suggest/appear/tend/often/generally");
  }

  // Contrast transitions
  if (!words.some(w => CONTRAST_WORDS.has(w))) {
    warnings.push("no_contrast: missing however/although/while/yet/but/despite");
  }

  // Passive voice
  const passiveMatch = item.passage.match(/\b(?:is|are|was|were|been|being)\s+\w+(?:ed|en|wn|ght|nd|lt|pt|ft|ck|ng)\b/gi);
  if (!passiveMatch || passiveMatch.length === 0) {
    warnings.push("no_passive_voice: should have at least one passive construction");
  }

  // First person
  if (item.passage.match(/\b(?:I|we|our|my|me)\b/)) {
    errors.push("first_person: academic passages must not use I/we/our");
  }

  // FK grade
  const fk = fleschKincaid(words, sentences.length);
  if (fk < 8 || fk > 22) {
    warnings.push(`FK_grade: ${fk.toFixed(1)} (target 11-18)`);
  }

  // ── 3. Quality gates ──

  // Question type diversity
  const types = new Set(item.questions.map(q => q.question_type).filter(Boolean));
  if (types.size < 3) {
    warnings.push(`question_type_diversity: only ${types.size} types (need ≥3)`);
  }

  // Option length balance + correct-is-longest check
  let correctLongestCount = 0;
  for (let i = 0; i < item.questions.length; i++) {
    const q = item.questions[i];
    if (!q.options || !q.correct_answer) continue;

    const lens = Object.entries(q.options).map(([k, v]) => ({ key: k, len: wc(v) }));
    const maxLen = Math.max(...lens.map(l => l.len));
    const minLen = Math.min(...lens.map(l => l.len));
    const correctLen = lens.find(l => l.key === q.correct_answer)?.len || 0;

    if (correctLen === maxLen && lens.filter(l => l.len === maxLen).length === 1) {
      correctLongestCount++;
    }

    if (maxLen - minLen > 12) {
      warnings.push(`Q${i + 1}: option_length_spread (${minLen}-${maxLen} words)`);
    }

    // Check option inter-similarity
    const optWords = Object.values(q.options).map(o =>
      new Set(o.toLowerCase().replace(/[^a-z'\s]/g, " ").split(/\s+/).filter(w => w.length > 3))
    );
    for (let a = 0; a < optWords.length; a++) {
      for (let b = a + 1; b < optWords.length; b++) {
        const inter = [...optWords[a]].filter(w => optWords[b].has(w)).length;
        const smaller = Math.min(optWords[a].size, optWords[b].size);
        if (smaller > 2 && inter / smaller > 0.7) {
          warnings.push(`Q${i + 1}: options_too_similar`);
        }
      }
    }
  }

  if (correctLongestCount >= 3) {
    warnings.push(`correct_is_longest: ${correctLongestCount}/5 questions — too many`);
  }

  // Answer position check — within single item shouldn't have all same
  const answerPositions = item.questions.map(q => q.correct_answer).filter(Boolean);
  if (answerPositions.length >= 5 && new Set(answerPositions).size === 1) {
    errors.push("answer_position: all 5 answers are the same position");
  }

  return { pass: errors.length === 0, errors, warnings };
}

/**
 * Validate a batch of AP items.
 */
function validateAPBatch(items) {
  const batchWarnings = [];

  // Answer position distribution
  const posCounts = { A: 0, B: 0, C: 0, D: 0 };
  items.forEach(item => {
    (item.questions || []).forEach(q => {
      if (q.correct_answer) posCounts[q.correct_answer]++;
    });
  });

  const totalQ = Object.values(posCounts).reduce((s, v) => s + v, 0);
  if (totalQ > 0) {
    for (const [pos, count] of Object.entries(posCounts)) {
      const pct = count / totalQ;
      if (pct > 0.40) batchWarnings.push(`answer_skew: ${pos}=${(pct * 100).toFixed(0)}%`);
    }
  }

  // Topic diversity
  const topics = new Set(items.map(i => i.topic));
  if (items.length >= 3 && topics.size < 2) {
    batchWarnings.push("topic_monotony: batch has fewer than 2 distinct topics");
  }

  return { warnings: batchWarnings, answerDistribution: posCounts };
}

module.exports = { validateAPItem, validateAPBatch };
