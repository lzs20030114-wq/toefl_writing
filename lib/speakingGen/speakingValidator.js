/**
 * Speaking Validator v2 — schema + profile + flavor scoring
 *
 * Validates both Listen & Repeat sentence sets and Interview question sets.
 * Based on data/speaking/profile/repeat-flavor-model.json
 *         data/speaking/profile/interview-flavor-model.json
 *
 * Three-level validation:
 *   Level 1: Schema (hard errors -> reject)
 *   Level 2: Profile checks (warnings)
 *   Level 3: Flavor scoring (0-1 scale, weighted composite)
 */

// ── Shared utilities ──

function wc(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const BLOCKED_WORDS = new Set([
  "damn", "hell", "shit", "fuck", "ass", "crap", "bitch", "bastard",
  "dick", "piss", "slut", "whore",
]);

function containsBlockedWord(text) {
  const words = text.toLowerCase().split(/\s+/);
  return words.some(w => BLOCKED_WORDS.has(w.replace(/[^a-z]/g, "")));
}

function isProperEnglish(text) {
  if (!/^[A-Z"']/.test(text)) return false;
  if (!/[.?!"]$/.test(text.trim())) return false;
  const ascii = text.replace(/[^a-zA-Z\s]/g, "").length;
  return ascii / text.length > 0.6;
}

// ═══════════════════════════════════════════════════════════════════
//  REPEAT VALIDATION
// ═══════════════════════════════════════════════════════════════════

const REPEAT_WORD_RANGES = {
  easy:   { min: 4, max: 7 },
  medium: { min: 8, max: 12 },
  hard:   { min: 13, max: 20 },
};

const REPEAT_TIMING = {
  easy: 8,
  medium: 10,
  hard: 12,
};

const VALID_REPEAT_DIFFICULTIES = new Set(["easy", "medium", "hard"]);

// ── Level 1: Repeat sentence schema ──

function validateRepeatSentenceSchema(sentence) {
  const errors = [];
  if (!sentence || typeof sentence !== "object") {
    return ["sentence must be an object"];
  }

  const text = sentence.sentence || "";
  if (!text || typeof text !== "string" || text.trim().length < 5) {
    errors.push("sentence: must be a non-empty string (min 5 chars)");
    return errors;
  }

  const words = wc(text);
  if (words < 3 || words > 25) {
    errors.push(`word_count: ${words} (absolute range 3-25)`);
  }

  if (containsBlockedWord(text)) {
    errors.push("profanity: contains blocked words");
  }

  if (sentence.difficulty && !VALID_REPEAT_DIFFICULTIES.has(sentence.difficulty)) {
    errors.push(`difficulty: "${sentence.difficulty}" not in [easy, medium, hard]`);
  }

  return errors;
}

// ── Level 2: Repeat sentence profile ──

function validateRepeatSentenceProfile(sentence) {
  const warnings = [];
  const text = sentence.sentence || "";
  const words = wc(text);
  const diff = sentence.difficulty || "medium";
  const range = REPEAT_WORD_RANGES[diff];

  if (range) {
    if (words < range.min) {
      warnings.push(`${diff}_too_short: ${words} words (target ${range.min}-${range.max})`);
    }
    if (words > range.max) {
      warnings.push(`${diff}_too_long: ${words} words (target ${range.min}-${range.max})`);
    }
  }

  if (!isProperEnglish(text)) {
    warnings.push("format: sentence may have capitalization/punctuation issues");
  }

  // Hard sentences should have multiple clauses
  if (diff === "hard" && !/[,;]/.test(text) && words >= 13) {
    warnings.push("hard_no_clause_break: hard sentence has no comma/semicolon (expected multi-clause)");
  }

  // Easy sentences should be simple
  if (diff === "easy" && /[,;]/.test(text) && words <= 6) {
    warnings.push("easy_has_clause_break: easy sentence has comma (expected simple structure)");
  }

  return warnings;
}

// ── Level 3: Repeat set flavor scoring ──

function scoreRepeatFlavor(set) {
  const scores = {};
  const sentences = set.sentences || [];

  // 1. Word count accuracy (weight: 0.25)
  // How many sentences fall within their difficulty's word range
  let inRange = 0;
  for (const s of sentences) {
    const w = wc(s.sentence || "");
    const range = REPEAT_WORD_RANGES[s.difficulty];
    if (range && w >= range.min && w <= range.max) inRange++;
  }
  scores.word_count_accuracy = sentences.length > 0 ? inRange / sentences.length : 0;

  // 2. Difficulty progression (weight: 0.20)
  // Check positions: 1-2 easy, 3-5 medium, 6-7 hard
  const diffs = sentences.map(s => s.difficulty);
  let progScore = 0;
  if (diffs.length >= 7) {
    if (diffs[0] === "easy" && diffs[1] === "easy") progScore += 0.4;
    if (diffs.slice(2, 5).every(d => d === "medium")) progScore += 0.3;
    if (diffs[5] === "hard" && diffs[6] === "hard") progScore += 0.3;
  } else if (diffs.length >= 5) {
    // Partial credit for shorter sets
    const hasEasyStart = diffs.slice(0, 2).some(d => d === "easy");
    const hasHardEnd = diffs.slice(-2).some(d => d === "hard");
    progScore = (hasEasyStart ? 0.4 : 0) + (hasHardEnd ? 0.3 : 0) + 0.1;
  }
  scores.difficulty_progression = progScore;

  // 3. Scenario coherence (weight: 0.20)
  // Check that set has scenario and speaker_role fields
  const hasScenario = !!set.scenario && typeof set.scenario === "string";
  const hasRole = !!set.speaker_role && typeof set.speaker_role === "string";
  scores.scenario_coherence = (hasScenario ? 0.5 : 0) + (hasRole ? 0.5 : 0);

  // 4. Sentence structure match (weight: 0.15)
  // Easy should be short/simple, hard should have commas (multi-clause)
  let structScore = 0;
  const easySentences = sentences.filter(s => s.difficulty === "easy");
  const hardSentences = sentences.filter(s => s.difficulty === "hard");
  // Easy: no commas or very short
  const easySimple = easySentences.filter(s => {
    const t = s.sentence || "";
    return !t.includes(",") || wc(t) <= 5;
  });
  structScore += easySentences.length > 0 ? (easySimple.length / easySentences.length) * 0.5 : 0.25;
  // Hard: has comma/semicolon (multi-clause indicator)
  const hardComplex = hardSentences.filter(s => /[,;]/.test(s.sentence || ""));
  structScore += hardSentences.length > 0 ? (hardComplex.length / hardSentences.length) * 0.5 : 0.25;
  scores.sentence_structure_match = structScore;

  // 5. Phonetic challenge density (weight: 0.10)
  // Check if phonetic_focus field is present on sentences
  const withPhonetic = sentences.filter(s => s.phonetic_focus && s.phonetic_focus.length > 0);
  scores.phonetic_challenge_density = sentences.length > 0 ? Math.min(1, withPhonetic.length / sentences.length) : 0;

  // 6. Natural spoken register (weight: 0.10)
  // Contractions, direct address
  const withContraction = sentences.filter(s => /\b(you'll|we'll|it's|we're|you're|they're|don't|can't|won't|isn't|aren't)\b/i.test(s.sentence || ""));
  const withDirectAddr = sentences.filter(s => /\byou(r)?\b/i.test(s.sentence || ""));
  const contractRate = sentences.length > 0 ? withContraction.length / sentences.length : 0;
  const addrRate = sentences.length > 0 ? withDirectAddr.length / sentences.length : 0;
  scores.natural_spoken_register = Math.min(1, contractRate * 0.5 + addrRate * 0.5);

  // Weighted total
  const weights = {
    word_count_accuracy: 0.25,
    difficulty_progression: 0.20,
    scenario_coherence: 0.20,
    sentence_structure_match: 0.15,
    phonetic_challenge_density: 0.10,
    natural_spoken_register: 0.10,
  };

  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += (scores[key] || 0) * weight;
  }

  return { scores, total: Math.round(total * 100) / 100, weights };
}

// ── Main repeat set validation ──

/**
 * Validate a repeat set (7 sentences).
 * @param {object} set — { id, scenario, speaker_role, sentences: [...] }
 * @returns {{ valid: boolean, errors: string[], warnings: string[], flavor: object|null }}
 */
function validateRepeatSet(set) {
  const errors = [];
  const warnings = [];

  if (!set || typeof set !== "object") {
    return { valid: false, errors: ["set must be an object"], warnings: [], flavor: null };
  }

  if (!set.id || typeof set.id !== "string") {
    errors.push("id: must be a non-empty string");
  }

  const sentences = set.sentences || [];
  if (!Array.isArray(sentences)) {
    errors.push("sentences: must be an array");
    return { valid: false, errors, warnings: [], flavor: null };
  }

  if (sentences.length !== 7) {
    if (sentences.length < 5) {
      errors.push(`sentences: need 7, got ${sentences.length}`);
    } else {
      warnings.push(`sentences: expected 7, got ${sentences.length}`);
    }
  }

  // Validate each sentence schema
  for (let i = 0; i < sentences.length; i++) {
    const schemaErrors = validateRepeatSentenceSchema(sentences[i]);
    if (schemaErrors.length > 0) {
      schemaErrors.forEach(e => errors.push(`sentence[${i}]: ${e}`));
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, flavor: null };
  }

  // Profile checks
  for (let i = 0; i < sentences.length; i++) {
    const profileWarnings = validateRepeatSentenceProfile(sentences[i]);
    profileWarnings.forEach(w => warnings.push(`sentence[${i}]: ${w}`));
  }

  // Difficulty distribution check
  const diffs = sentences.map(s => s.difficulty);
  const easyCount = diffs.filter(d => d === "easy").length;
  const medCount = diffs.filter(d => d === "medium").length;
  const hardCount = diffs.filter(d => d === "hard").length;
  if (sentences.length === 7 && (easyCount !== 2 || medCount !== 3 || hardCount !== 2)) {
    warnings.push(`difficulty_distribution: got easy=${easyCount} medium=${medCount} hard=${hardCount} (expected 2/3/2)`);
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

  // Missing scenario metadata
  if (!set.scenario) warnings.push("missing_scenario: set has no scenario field");
  if (!set.speaker_role) warnings.push("missing_speaker_role: set has no speaker_role field");

  // Flavor scoring
  const flavor = scoreRepeatFlavor(set);
  if (flavor.total < 0.40) {
    warnings.push(`low_flavor_score: ${flavor.total} (target >= 0.65)`);
  }

  return { valid: errors.length === 0, errors, warnings, flavor };
}

// ═══════════════════════════════════════════════════════════════════
//  INTERVIEW VALIDATION
// ═══════════════════════════════════════════════════════════════════

const INTERVIEW_WORD_RANGES = {
  Q1: { min: 25, max: 40 },
  Q2: { min: 25, max: 45 },
  Q3: { min: 25, max: 45 },
  Q4: { min: 30, max: 50 },
};

const VALID_INTERVIEW_POSITIONS = new Set(["Q1", "Q2", "Q3", "Q4"]);
const VALID_INTERVIEW_DIFFICULTIES = new Set(["personal", "descriptive", "analytical", "evaluative"]);

// ── Level 1: Interview question schema ──

function validateInterviewQuestionSchema(q) {
  const errors = [];
  if (!q || typeof q !== "object") {
    return ["question must be an object"];
  }

  const text = q.question || "";
  if (!text || typeof text !== "string" || text.trim().length < 15) {
    errors.push("question: must be a non-empty string (min 15 chars)");
    return errors;
  }

  const words = wc(text);
  if (words < 10 || words > 60) {
    errors.push(`word_count: ${words} (absolute range 10-60)`);
  }

  if (containsBlockedWord(text)) {
    errors.push("profanity: contains blocked words");
  }

  return errors;
}

// ── Level 2: Interview question profile ──

function validateInterviewQuestionProfile(q, index) {
  const warnings = [];
  const text = q.question || "";
  const words = wc(text);
  const pos = q.position || `Q${index + 1}`;
  const range = INTERVIEW_WORD_RANGES[pos];

  // Word count check
  if (range) {
    if (words < range.min) {
      warnings.push(`${pos}_too_short: ${words} words (target ${range.min}-${range.max})`);
    }
    if (words > range.max) {
      warnings.push(`${pos}_too_long: ${words} words (target ${range.min}-${range.max})`);
    }
  }

  // Q1 should start with "Thank you for participating"
  if (pos === "Q1" && !/^thank you for participating/i.test(text.trim())) {
    warnings.push("Q1_missing_opener: Q1 should start with 'Thank you for participating'");
  }

  // Q3 should contain debatable claim pattern
  if (pos === "Q3" && !/some\s+(people|experts|educators|nutritionists|researchers|companies|scholars|scientists)/i.test(text)) {
    warnings.push("Q3_missing_claim: Q3 should use 'Some [people/experts] [argue/believe]...' pattern");
  }

  // Q4 should reference future
  if (pos === "Q4" && !/future|next\s+(decade|five|ten|few)|looking ahead|will\s+(change|evolve|impact|affect)|going forward/i.test(text)) {
    warnings.push("Q4_missing_future: Q4 should reference future trends or timeline");
  }

  // Open-ended check: should not be answerable with yes/no only
  if (/^(do you|can you|is it|are you|have you|did you|would you|will you)\b/i.test(text.trim()) &&
      !text.includes("?") || (text.match(/\?/g) || []).length === 1) {
    // Single yes/no question without follow-up
    const hasFollowUp = /why|how|what|which|describe|explain|in what way/i.test(text);
    if (!hasFollowUp) {
      warnings.push("yes_no_risk: question may be answerable with just yes/no");
    }
  }

  return warnings;
}

// ── Level 3: Interview set flavor scoring ──

function scoreInterviewFlavor(set) {
  const scores = {};
  const questions = set.questions || [];

  // 1. Question count (weight: 0.15)
  scores.question_count = questions.length === 4 ? 1 : questions.length >= 3 ? 0.5 : 0;

  // 2. Length accuracy (weight: 0.15)
  let inRange = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const w = wc(q.question || "");
    const pos = q.position || `Q${i + 1}`;
    const range = INTERVIEW_WORD_RANGES[pos];
    if (range && w >= range.min && w <= range.max) inRange++;
  }
  scores.length_accuracy = questions.length > 0 ? inRange / questions.length : 0;

  // 3. Progression match (weight: 0.25)
  let progScore = 0;
  if (questions.length >= 4) {
    const q1 = (questions[0].question || "").toLowerCase();
    const q3 = (questions[2].question || "").toLowerCase();
    const q4 = (questions[3].question || "").toLowerCase();

    // Q1 opener
    if (/thank you for participating/.test(q1)) progScore += 0.25;
    // Q3 debatable claim
    if (/some\s+(people|experts|educators|researchers|companies)/.test(q3)) progScore += 0.25;
    // Q4 future reference
    if (/future|next\s+(decade|five|ten|few)|looking ahead|will\s+(change|evolve|impact)/.test(q4)) progScore += 0.25;
    // Difficulty positions match
    const positions = questions.map(q => q.position || q.difficulty);
    if (positions[0] && /Q1|personal/.test(positions[0]) &&
        positions[3] && /Q4|evaluative|predictive/.test(positions[3])) {
      progScore += 0.25;
    }
  }
  scores.progression_match = progScore;

  // 4. Open-ended check (weight: 0.15)
  const openEnded = questions.filter(q => {
    const text = (q.question || "").toLowerCase();
    // Contains wh-word or imperative or multi-part
    return /what|how|why|describe|explain|in what way|to what extent/.test(text) ||
           (text.match(/\?/g) || []).length >= 1;
  });
  scores.open_ended_check = questions.length > 0 ? openEnded.length / questions.length : 0;

  // 5. Topic coherence (weight: 0.15)
  const hasTopic = !!set.topic && typeof set.topic === "string";
  const hasIntro = !!set.intro && typeof set.intro === "string";
  scores.topic_coherence = (hasTopic ? 0.5 : 0) + (hasIntro ? 0.5 : 0);

  // 6. Anti-pattern free (weight: 0.15)
  let antiPatternScore = 1.0;
  // Check for identical openers in Q2-Q4
  if (questions.length >= 4) {
    const openers = questions.slice(1).map(q => (q.question || "").split(/\s/)[0]?.toLowerCase());
    const uniqueOpeners = new Set(openers);
    if (uniqueOpeners.size < openers.length) antiPatternScore -= 0.3;
  }
  // Check for yes/no questions
  const yesNoCount = questions.filter(q => {
    const t = (q.question || "").trim();
    return /^(do you|can you|is it|are you|have you)\b/i.test(t) &&
           !/why|how|what|describe|explain/i.test(t);
  }).length;
  if (yesNoCount > 0) antiPatternScore -= yesNoCount * 0.2;
  scores.anti_pattern_free = Math.max(0, antiPatternScore);

  // Weighted total
  const weights = {
    question_count: 0.15,
    length_accuracy: 0.15,
    progression_match: 0.25,
    open_ended_check: 0.15,
    topic_coherence: 0.15,
    anti_pattern_free: 0.15,
  };

  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += (scores[key] || 0) * weight;
  }

  return { scores, total: Math.round(total * 100) / 100, weights };
}

// ── Main interview set validation ──

/**
 * Validate an interview set (4 questions).
 * @param {object} set — { id, topic, intro, questions: [...] }
 * @returns {{ valid: boolean, errors: string[], warnings: string[], flavor: object|null }}
 */
function validateInterviewSet(set) {
  const errors = [];
  const warnings = [];

  if (!set || typeof set !== "object") {
    return { valid: false, errors: ["set must be an object"], warnings: [], flavor: null };
  }

  if (!set.id || typeof set.id !== "string") {
    errors.push("id: must be a non-empty string");
  }

  const questions = set.questions || [];
  if (!Array.isArray(questions)) {
    errors.push("questions: must be an array");
    return { valid: false, errors, warnings: [], flavor: null };
  }

  if (questions.length !== 4) {
    if (questions.length < 3) {
      errors.push(`questions: need 4, got ${questions.length}`);
    } else {
      warnings.push(`questions: expected 4, got ${questions.length}`);
    }
  }

  // Validate each question schema
  for (let i = 0; i < questions.length; i++) {
    const schemaErrors = validateInterviewQuestionSchema(questions[i]);
    if (schemaErrors.length > 0) {
      schemaErrors.forEach(e => errors.push(`question[${i}]: ${e}`));
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, flavor: null };
  }

  // Profile checks
  for (let i = 0; i < questions.length; i++) {
    const profileWarnings = validateInterviewQuestionProfile(questions[i], i);
    profileWarnings.forEach(w => warnings.push(`question[${i}]: ${w}`));
  }

  // Check for duplicate questions
  const textSet = new Set();
  for (const q of questions) {
    const norm = (q.question || "").toLowerCase().trim();
    if (textSet.has(norm)) {
      errors.push("duplicate: repeated question text within set");
    }
    textSet.add(norm);
  }

  // Missing metadata
  if (!set.topic) warnings.push("missing_topic: set has no topic field");
  if (!set.intro) warnings.push("missing_intro: set has no intro field");

  // Opener diversity check
  if (questions.length >= 3) {
    const firstWords = questions.slice(1).map(q => (q.question || "").split(/\s/)[0]?.toLowerCase());
    const uniqueFirstWords = new Set(firstWords);
    if (uniqueFirstWords.size < firstWords.length) {
      warnings.push("diversity: Q2-Q4 share identical opening words");
    }
  }

  // Flavor scoring
  const flavor = scoreInterviewFlavor(set);
  if (flavor.total < 0.40) {
    warnings.push(`low_flavor_score: ${flavor.total} (target >= 0.65)`);
  }

  return { valid: errors.length === 0, errors, warnings, flavor };
}

// ═══════════════════════════════════════════════════════════════════
//  BATCH VALIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a batch of sets for cross-set quality.
 * @param {object[]} sets
 * @param {"repeat"|"interview"} type
 * @returns {{ warnings: string[], avgFlavor: number, stats: object }}
 */
function validateBatch(sets, type) {
  const warnings = [];

  if (type === "repeat") {
    // Cross-set sentence dedup
    const allSentences = new Set();
    for (const set of sets) {
      for (const s of (set.sentences || [])) {
        const norm = (s.sentence || "").toLowerCase().trim();
        if (allSentences.has(norm)) {
          warnings.push(`cross_set_duplicate: "${norm.slice(0, 50)}..."`);
        }
        allSentences.add(norm);
      }
    }

    // Scenario diversity
    const scenarios = sets.map(s => s.scenario || "unknown");
    const uniqueScenarios = new Set(scenarios);
    if (uniqueScenarios.size < sets.length && sets.length > 1) {
      warnings.push(`scenario_diversity: ${uniqueScenarios.size} unique scenarios for ${sets.length} sets`);
    }
  }

  if (type === "interview") {
    // Cross-set question dedup
    const allQuestions = new Set();
    for (const set of sets) {
      for (const q of (set.questions || [])) {
        const norm = (q.question || "").toLowerCase().trim();
        if (allQuestions.has(norm)) {
          warnings.push(`cross_set_duplicate: "${norm.slice(0, 50)}..."`);
        }
        allQuestions.add(norm);
      }
    }

    // Topic diversity
    const topics = sets.map(s => s.topic || "unknown");
    const uniqueTopics = new Set(topics);
    if (uniqueTopics.size < sets.length && sets.length > 1) {
      warnings.push(`topic_diversity: ${uniqueTopics.size} unique topics for ${sets.length} sets`);
    }

    // Category diversity
    const categories = sets.map(s => s.category || "unknown");
    const uniqueCats = new Set(categories);
    if (uniqueCats.size === 1 && sets.length > 2) {
      warnings.push(`category_diversity: all sets in same category "${categories[0]}"`);
    }
  }

  // Average flavor
  const flavorScores = sets.map(set => {
    if (type === "repeat") return scoreRepeatFlavor(set).total;
    return scoreInterviewFlavor(set).total;
  });
  const avgFlavor = flavorScores.length > 0
    ? Math.round(flavorScores.reduce((a, b) => a + b, 0) / flavorScores.length * 100) / 100
    : 0;

  // Difficulty distribution (for repeat)
  const stats = {};
  if (type === "repeat") {
    const allDiffs = { easy: 0, medium: 0, hard: 0 };
    for (const set of sets) {
      for (const s of (set.sentences || [])) {
        if (allDiffs[s.difficulty] !== undefined) allDiffs[s.difficulty]++;
      }
    }
    stats.difficulty_distribution = allDiffs;
  }

  if (type === "interview") {
    const catDist = {};
    for (const set of sets) {
      const cat = set.category || "unknown";
      catDist[cat] = (catDist[cat] || 0) + 1;
    }
    stats.category_distribution = catDist;
  }

  return { warnings, avgFlavor, stats };
}

module.exports = {
  // Repeat
  validateRepeatSet,
  scoreRepeatFlavor,
  REPEAT_WORD_RANGES,
  REPEAT_TIMING,
  // Interview
  validateInterviewSet,
  scoreInterviewFlavor,
  INTERVIEW_WORD_RANGES,
  // Batch
  validateBatch,
};
