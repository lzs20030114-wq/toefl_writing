/**
 * Listen to an Announcement (LA) -- Validator v2
 *
 * Three-level validation + ETS flavor scoring.
 * Based on data/listening/profile/la-flavor-model.json
 *
 * Level 1: Schema (hard errors -> reject)
 * Level 2: Profile (warnings -- info types, register, Q1/Q2 diversity)
 * Level 3: Flavor scoring (7 weighted markers)
 */

const VALID_ANSWERS = ["A", "B", "C", "D"];
const VALID_Q_TYPES = ["detail", "main_idea", "inference"];

// -- Utility functions ---------------------------------------------------

function wc(s) { return s.split(/\s+/).filter(Boolean).length; }

function sentenceCount(s) {
  return s.split(/[.!?]+/).filter(seg => seg.trim().length > 3).length;
}

// Semi-formal register markers (positive)
const FORMAL_MARKERS = [
  /\battention\b/i,
  /\bplease (note|be aware|ensure|bring|do not|sign)\b/i,
  /\bwe (are|want to|will be|would like|invite|encourage|highly)\b/i,
  /\b(thrilled|excited|pleased) to (announce|inform|invite)\b/i,
  /\bstudents,? faculty,? and staff\b/i,
  /\bis required\b/i,
  /\bmust be\b/i,
];

// Casual register markers (negative -- should NOT appear)
const CASUAL_MARKERS = [
  /\bhey (guys|everyone|folks)\b/i,
  /\bwhat's up\b/i,
  /\bgonna\b/i,
  /\bwanna\b/i,
  /\bcool\b/i,
  /\bawesome\b/i,
  /\byeah\b/i,
  /\bnope\b/i,
  /\blol\b/i,
  /\bOMG\b/i,
];

// Info type detection patterns
const INFO_PATTERNS = {
  date: [
    /\b(this|next|last) (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i,
    /\b\d{1,2}(st|nd|rd|th)\b/i,
    /\btomorrow\b/i,
    /\btoday\b/i,
    /\b(this|next) (week|month|semester)\b/i,
  ],
  time: [
    /\b\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?|AM|PM)\b/i,
    /\bat\s+\d{1,2}\s*(a\.?m\.?|p\.?m\.?|AM|PM)\b/i,
    /\bfrom\s+\d{1,2}.*to\s+\d{1,2}/i,
    /\b(noon|midnight)\b/i,
    /\b(morning|afternoon|evening)\b/i,
  ],
  location: [
    /\bin\s+(the\s+)?[A-Z][a-z]+\s+(Hall|Center|Building|Auditorium|Room|Library|Lab|Lounge|Studio|Gallery|Office|Atrium|Gym)/,
    /\bbehind (the\s+)?[A-Z]/,
    /\bnear (the\s+)?[A-Z]/,
    /\bin Room\s+\d+/i,
    /\b(Lot|Lots)\s+[A-Z]/,
    /\b(campus|quad|atrium|auditorium|gymnasium|cafeteria|stadium)\b/i,
  ],
  requirement: [
    /\b(required|must|need to|have to|are asked to)\b/i,
    /\bplease (bring|ensure|complete|submit|note|wear|sign|do not)\b/i,
    /\bmandatory\b/i,
    /\bnecessary\b/i,
  ],
  deadline: [
    /\bdeadline\b/i,
    /\bby\s+(this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /\bby\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i,
    /\bmust be submitted\b/i,
    /\bdue\b/i,
  ],
  action_channel: [
    /\b(sign up|register|submit|upload|log in|visit)\b.*\b(website|portal|online|link|app)\b/i,
    /\b(website|portal)\b.*\b(sign up|register|submit)\b/i,
    /\bemail\b/i,
  ],
};

function detectInfoTypes(text) {
  const found = {};
  for (const [type, patterns] of Object.entries(INFO_PATTERNS)) {
    found[type] = patterns.some(p => p.test(text));
  }
  return found;
}

// Opening pattern detection
function detectOpening(text) {
  const lower = text.toLowerCase().trim();
  if (/^attention\b/.test(lower)) return "attention";
  if (/^good (morning|afternoon|evening)\b/.test(lower)) return "greeting";
  if (/^this is a reminder\b/.test(lower)) return "reminder";
  return "direct";
}

// -- Level 1: Schema validation (hard errors -> reject) ------------------

function validateSchema(item) {
  const errors = [];

  if (!item.announcement || typeof item.announcement !== "string") {
    errors.push("missing_announcement");
    return errors;
  }
  if (!Array.isArray(item.questions) || item.questions.length === 0) {
    errors.push("missing_questions");
    return errors;
  }

  // Announcement word count (allow 40-150 for flexibility, flag 80-120 in profile)
  const annoWc = wc(item.announcement);
  if (annoWc < 30) errors.push(`announcement_too_short: ${annoWc} words (min 40)`);
  if (annoWc > 170) errors.push(`announcement_too_long: ${annoWc} words (max 150)`);

  // Exactly 2 questions
  if (item.questions.length !== 2) {
    errors.push(`wrong_question_count: ${item.questions.length} (must be exactly 2)`);
  }

  if (errors.length > 0) return errors;

  // Validate each question schema
  for (let qi = 0; qi < item.questions.length; qi++) {
    const q = item.questions[qi];
    const prefix = `q${qi + 1}`;

    if (!q.stem || typeof q.stem !== "string") {
      errors.push(`${prefix}_missing_stem`);
      continue;
    }
    if (!q.options || typeof q.options !== "object") {
      errors.push(`${prefix}_missing_options`);
      continue;
    }
    if (!q.answer || !VALID_ANSWERS.includes(q.answer)) {
      errors.push(`${prefix}_invalid_answer: "${q.answer}"`);
      continue;
    }

    // All 4 options present
    for (const key of VALID_ANSWERS) {
      if (!q.options[key] || typeof q.options[key] !== "string") {
        errors.push(`${prefix}_missing_option_${key}`);
      }
    }

    // Option word counts
    for (const key of VALID_ANSWERS) {
      if (!q.options[key]) continue;
      const optWc = wc(q.options[key]);
      if (optWc < 2) errors.push(`${prefix}_option_${key}_too_short: ${optWc} words`);
      if (optWc > 25) errors.push(`${prefix}_option_${key}_too_long: ${optWc} words`);
    }
  }

  return errors;
}

// -- Level 2: Profile checks (warnings) ----------------------------------

function validateProfile(item) {
  const warnings = [];
  const annoWc = wc(item.announcement);
  const annoSentences = sentenceCount(item.announcement);

  // Word count outside ideal range (80-120)
  if (annoWc < 50) {
    warnings.push(`announcement_short: ${annoWc} words (ideal 80-120)`);
  } else if (annoWc > 150) {
    warnings.push(`announcement_long: ${annoWc} words (ideal 80-120)`);
  }

  // Sentence count (target 5-7)
  if (annoSentences < 4) {
    warnings.push(`too_few_sentences: ${annoSentences} (target 5-7)`);
  } else if (annoSentences > 9) {
    warnings.push(`too_many_sentences: ${annoSentences} (target 5-7)`);
  }

  // Info type checks
  const infoTypes = detectInfoTypes(item.announcement);
  if (!infoTypes.date) warnings.push("missing_date: 93% of ETS items have a specific date/day");
  if (!infoTypes.location) warnings.push("missing_location: 79% of ETS items have a location");

  // Opening pattern check
  const opening = detectOpening(item.announcement);
  // Not a hard check, but tracked

  // Register checks
  const hasFormal = FORMAL_MARKERS.some(p => p.test(item.announcement));
  if (!hasFormal) {
    warnings.push("missing_formal_register: no semi-formal markers (Attention, Please, We are...)");
  }
  const casualFound = CASUAL_MARKERS.filter(p => p.test(item.announcement));
  if (casualFound.length > 0) {
    warnings.push("casual_register_detected: announcement should be semi-formal, not casual");
  }

  // Speaker role
  if (!item.speaker_role) {
    warnings.push("missing_speaker_role");
  }

  // Context
  if (!item.context) {
    warnings.push("missing_context");
  }

  // Q1 and Q2 type diversity
  if (item.questions.length === 2) {
    const q1Type = item.questions[0].type;
    const q2Type = item.questions[1].type;
    if (q1Type && q2Type && q1Type === q2Type) {
      warnings.push(`q_type_not_diverse: both questions are ${q1Type} (should test different skills)`);
    }

    // Validate question types
    for (let qi = 0; qi < 2; qi++) {
      const q = item.questions[qi];
      if (q.type && !VALID_Q_TYPES.includes(q.type)) {
        warnings.push(`q${qi + 1}_invalid_type: "${q.type}" (must be detail/main_idea/inference)`);
      }
      if (!q.type) {
        warnings.push(`q${qi + 1}_missing_type`);
      }
      if (!q.explanation) {
        warnings.push(`q${qi + 1}_missing_explanation`);
      }
      if (!q.distractor_types || Object.keys(q.distractor_types).length < 3) {
        warnings.push(`q${qi + 1}_missing_distractor_types`);
      }
    }

    // Both answers same letter
    if (item.questions[0].answer === item.questions[1].answer) {
      warnings.push("both_answers_same_letter: Q1 and Q2 have the same correct answer position");
    }
  }

  // Per-question option checks
  for (let qi = 0; qi < item.questions.length; qi++) {
    const q = item.questions[qi];
    if (!q.options || !q.answer) continue;
    const prefix = `q${qi + 1}`;

    // Correct is longest check
    const optWcs = VALID_ANSWERS.map(k => q.options[k] ? wc(q.options[k]) : 0);
    const correctWc = q.options[q.answer] ? wc(q.options[q.answer]) : 0;
    const avgOtherWc = VALID_ANSWERS
      .filter(k => k !== q.answer)
      .map(k => q.options[k] ? wc(q.options[k]) : 0)
      .reduce((a, b) => a + b, 0) / 3;

    if (correctWc > avgOtherWc * 1.5 && correctWc > 8) {
      warnings.push(`${prefix}_correct_is_longest: ${correctWc} vs avg distractor ${Math.round(avgOtherWc)}`);
    }

    // Option length spread
    const spread = Math.max(...optWcs) - Math.min(...optWcs.filter(w => w > 0));
    if (spread > 8) {
      warnings.push(`${prefix}_option_length_spread: ${spread} words (target <= 5)`);
    }

    // Ambiguity detection: distractor might also answer the question
    const distractorKeys = VALID_ANSWERS.filter(k => k !== q.answer);
    const annoLower = item.announcement.toLowerCase();

    for (const k of distractorKeys) {
      if (!q.options[k]) continue;
      const optLower = q.options[k].toLowerCase();

      // Check if distractor text appears almost verbatim in announcement
      const optWords = optLower.split(/\s+/).filter(w => w.length > 3);
      const matchCount = optWords.filter(w => annoLower.includes(w)).length;
      if (optWords.length > 0 && matchCount / optWords.length > 0.8 && optWords.length >= 4) {
        warnings.push(`${prefix}_ambiguity_risk_${k}: distractor closely mirrors announcement text (${matchCount}/${optWords.length} content words match)`);
      }
    }
  }

  return warnings;
}

// -- Level 3: ETS Flavor scoring -----------------------------------------

function scoreFlavor(item) {
  const scores = {};

  // 1. Specific date AND location present (weight: 0.20)
  const infoTypes = detectInfoTypes(item.announcement);
  scores.specific_date_and_location = (infoTypes.date && infoTypes.location) ? 1 :
    (infoTypes.date || infoTypes.location) ? 0.5 : 0;

  // 2. Requirement or action instruction (weight: 0.20)
  scores.requirement_or_action = (infoTypes.requirement) ? 1 : 0;

  // 3. Q1/Q2 type diversity (weight: 0.15)
  if (item.questions.length === 2) {
    const q1Type = item.questions[0].type;
    const q2Type = item.questions[1].type;
    scores.q1_q2_type_diversity = (q1Type && q2Type && q1Type !== q2Type) ? 1 : 0;
  } else {
    scores.q1_q2_type_diversity = 0;
  }

  // 4. Semi-formal register (weight: 0.15)
  const formalCount = FORMAL_MARKERS.filter(p => p.test(item.announcement)).length;
  const casualCount = CASUAL_MARKERS.filter(p => p.test(item.announcement)).length;
  if (casualCount > 0) {
    scores.semi_formal_register = 0;
  } else if (formalCount >= 3) {
    scores.semi_formal_register = 1;
  } else if (formalCount >= 1) {
    scores.semi_formal_register = 0.6;
  } else {
    scores.semi_formal_register = 0.2;
  }

  // 5. Distractor plausibility (weight: 0.15)
  // Check that all distractors have reasonable word counts and distractor_types are annotated
  let distractorScore = 1;
  for (const q of item.questions) {
    if (!q.options || !q.answer) { distractorScore = 0; break; }
    const distractorKeys = VALID_ANSWERS.filter(k => k !== q.answer);
    for (const k of distractorKeys) {
      if (!q.options[k]) { distractorScore -= 0.2; continue; }
      const dWc = wc(q.options[k]);
      if (dWc < 3 || dWc > 15) distractorScore -= 0.1;
    }
    if (!q.distractor_types || Object.keys(q.distractor_types).length < 3) {
      distractorScore -= 0.2;
    }
  }
  scores.distractor_plausibility = Math.max(0, Math.min(1, distractorScore));

  // 6. Correct not always longest (weight: 0.10)
  let longestCount = 0;
  for (const q of item.questions) {
    if (!q.options || !q.answer) continue;
    const optWcs = VALID_ANSWERS.map(k => q.options[k] ? wc(q.options[k]) : 0);
    const correctWc = q.options[q.answer] ? wc(q.options[q.answer]) : 0;
    if (correctWc === Math.max(...optWcs)) longestCount++;
  }
  scores.correct_not_always_longest = longestCount === 0 ? 1 :
    longestCount === 1 ? 0.5 : 0;

  // 7. Answer position balance (weight: 0.05)
  // Per-item: Q1 and Q2 should have different answer positions
  if (item.questions.length === 2) {
    scores.answer_position_balance = item.questions[0].answer !== item.questions[1].answer ? 1 : 0;
  } else {
    scores.answer_position_balance = 0.5;
  }

  // Weighted total
  const weights = {
    specific_date_and_location: 0.20,
    requirement_or_action: 0.20,
    q1_q2_type_diversity: 0.15,
    semi_formal_register: 0.15,
    distractor_plausibility: 0.15,
    correct_not_always_longest: 0.10,
    answer_position_balance: 0.05,
  };

  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += (scores[key] || 0) * weight;
  }

  return { scores, total: Math.round(total * 100) / 100, weights };
}

// -- Main validation function --------------------------------------------

/**
 * Validate a single LA item.
 *
 * @param {object} item
 * @returns {{ valid: boolean, errors: string[], warnings: string[], flavor: object }}
 */
function validateLA(item) {
  // Level 1: Schema
  const errors = validateSchema(item);
  if (errors.length > 0) {
    return { valid: false, errors, warnings: [], flavor: null };
  }

  // Level 2: Profile
  const warnings = validateProfile(item);

  // Level 3: Flavor scoring
  const flavor = scoreFlavor(item);

  if (flavor.total < 0.40) {
    warnings.push(`low_flavor_score: ${flavor.total} (target >= 0.65)`);
  }

  return { valid: true, errors: [], warnings, flavor };
}

/**
 * Validate batch-level quality.
 *
 * @param {object[]} items
 * @returns {object}
 */
function validateBatch(items) {
  // Answer distribution (across all questions)
  const dist = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of items) {
    for (const q of (item.questions || [])) {
      if (q.answer && dist[q.answer] !== undefined) dist[q.answer]++;
    }
  }
  const vals = Object.values(dist);
  const balanced = Math.max(...vals) - Math.min(...vals) <= 3;

  // Average flavor score
  const flavorScores = items.map(item => scoreFlavor(item).total);
  const avgFlavor = flavorScores.length > 0
    ? Math.round(flavorScores.reduce((a, b) => a + b, 0) / flavorScores.length * 100) / 100
    : 0;

  // Q type distribution
  const qTypeDist = { detail: 0, main_idea: 0, inference: 0 };
  for (const item of items) {
    for (const q of (item.questions || [])) {
      const t = q.type || "unknown";
      if (qTypeDist[t] !== undefined) qTypeDist[t]++;
    }
  }

  // Context distribution
  const contextDist = {};
  for (const item of items) {
    const c = item.context || "unknown";
    contextDist[c] = (contextDist[c] || 0) + 1;
  }

  // Difficulty distribution
  const difficultyDist = {};
  for (const item of items) {
    const d = item.difficulty || "unknown";
    difficultyDist[d] = (difficultyDist[d] || 0) + 1;
  }

  // Info type coverage
  const infoTypeCoverage = { date: 0, time: 0, location: 0, requirement: 0, deadline: 0, action_channel: 0 };
  for (const item of items) {
    const info = detectInfoTypes(item.announcement);
    for (const [type, found] of Object.entries(info)) {
      if (found && infoTypeCoverage[type] !== undefined) infoTypeCoverage[type]++;
    }
  }
  // Convert to rates
  const infoTypeRates = {};
  for (const [type, count] of Object.entries(infoTypeCoverage)) {
    infoTypeRates[type] = items.length > 0 ? Math.round(count / items.length * 100) : 0;
  }

  // Opening pattern distribution
  const openingDist = {};
  for (const item of items) {
    const opening = detectOpening(item.announcement);
    openingDist[opening] = (openingDist[opening] || 0) + 1;
  }

  // Correct-is-longest rate
  let totalQuestions = 0;
  let correctIsLongest = 0;
  for (const item of items) {
    for (const q of (item.questions || [])) {
      if (!q.options || !q.answer) continue;
      totalQuestions++;
      const optWcs = VALID_ANSWERS.map(k => q.options[k] ? wc(q.options[k]) : 0);
      const correctWc = q.options[q.answer] ? wc(q.options[q.answer]) : 0;
      if (correctWc === Math.max(...optWcs)) correctIsLongest++;
    }
  }
  const correctIsLongestRate = totalQuestions > 0 ? Math.round(correctIsLongest / totalQuestions * 100) : 0;

  return {
    distribution: dist,
    balanced,
    avgFlavor,
    qTypeDist,
    contextDist,
    difficultyDist,
    infoTypeRates,
    openingDist,
    correctIsLongestRate,
  };
}

module.exports = { validateLA, validateBatch, scoreFlavor };
