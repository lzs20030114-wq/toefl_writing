/**
 * Listen to an Academic Talk (LAT) -- Validator v2
 *
 * Three-level validation + ETS flavor scoring.
 * Based on data/listening/profile/lat-flavor-model.json
 *
 * Level 1: Schema (hard errors -> reject)
 * Level 2: Profile (warnings -- register, structure, Q diversity)
 * Level 3: Flavor scoring (8 weighted markers)
 */

const VALID_ANSWERS = ["A", "B", "C", "D"];
const VALID_Q_TYPES = ["main_idea", "detail", "inference", "function", "predict_next", "attitude"];

// -- Utility functions ---------------------------------------------------

function wc(s) { return s.split(/\s+/).filter(Boolean).length; }

// Contraction detection
const CONTRACTIONS = /\b(i'm|i'll|i've|i'd|don't|didn't|doesn't|isn't|aren't|wasn't|weren't|can't|couldn't|won't|wouldn't|shouldn't|it's|that's|there's|here's|what's|who's|he's|she's|we're|they're|you're|let's|haven't|hasn't|we've|you've)\b/i;

// Discourse marker detection
const DISCOURSE_MARKERS = [
  "actually", "so", "now", "well", "let me", "here's the thing",
  "here's the key", "what's interesting", "what's really interesting",
  "okay", "alright", "right", "basically", "in other words",
  "it turns out", "here's what",
];

// Academic spoken register markers
const SPOKEN_MARKERS = [
  /\byou('ve| might| probably| know)\b/i,
  /\bthink about\b/i,
  /\bimagine\b/i,
  /\bright\?/i,
  /\bhere's (the|what)\b/i,
  /\blet me (give|show|explain)\b/i,
  /\bit turns out\b/i,
  /\bin other words\b/i,
];

// Formal/written markers (should NOT appear in spoken lecture)
const WRITTEN_MARKERS = [
  /\bfurthermore\b/i,
  /\bnevertheless\b/i,
  /\bsubsequently\b/i,
  /\bin accordance with\b/i,
  /\bhereby\b/i,
  /\bwhereas\b/i,
  /\bit should be noted\b/i,
  /\bthe aforementioned\b/i,
  /\bas previously stated\b/i,
  /\bin conclusion\b/i,
];

// -- Level 1: Schema validation (hard errors -> reject) ------------------

function validateSchema(item) {
  const errors = [];

  // Required fields
  if (!item.transcript || typeof item.transcript !== "string") {
    errors.push("missing_transcript");
    return errors;
  }
  if (!Array.isArray(item.questions) || item.questions.length === 0) {
    errors.push("missing_questions");
    return errors;
  }

  // Word count: 100-300 (generous bounds)
  const totalWords = wc(item.transcript);
  if (totalWords < 100) {
    errors.push(`transcript_too_short: ${totalWords} words (min 120)`);
  } else if (totalWords > 320) {
    errors.push(`transcript_too_long: ${totalWords} words (max 300)`);
  }

  // Question count: 3-5 (target 4)
  if (item.questions.length < 3) {
    errors.push(`too_few_questions: ${item.questions.length} (min 3)`);
  } else if (item.questions.length > 6) {
    errors.push(`too_many_questions: ${item.questions.length} (max 5)`);
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

  // Word count ideal range
  const totalWords = wc(item.transcript);
  if (totalWords < 150) {
    warnings.push(`transcript_short: ${totalWords} words (ideal 180-220)`);
  } else if (totalWords > 260) {
    warnings.push(`transcript_long: ${totalWords} words (ideal 180-220)`);
  }

  // Question count ideal
  if (item.questions.length !== 4) {
    warnings.push(`question_count: ${item.questions.length} (target 4)`);
  }

  // Transcript register: contractions
  const text = item.transcript;
  if (!CONTRACTIONS.test(text)) {
    warnings.push("no_contractions: lecture should use contractions for spoken register");
  }

  // Discourse markers
  const textLower = text.toLowerCase();
  const dmFound = DISCOURSE_MARKERS.filter(m => textLower.includes(m));
  if (dmFound.length < 2) {
    warnings.push(`few_discourse_markers: ${dmFound.length} found (min 4 target)`);
  }

  // Spoken register markers
  const spokenFound = SPOKEN_MARKERS.filter(p => p.test(text));
  if (spokenFound.length < 1) {
    warnings.push("no_spoken_markers: should address students (you, think about, imagine)");
  }

  // Written/formal check
  const writtenFound = WRITTEN_MARKERS.filter(p => p.test(text));
  if (writtenFound.length > 0) {
    warnings.push("written_register_detected: lecture sounds too formal/written");
  }

  // Uses "you" (addressing students)
  if (!/\byou\b/i.test(text)) {
    warnings.push("no_student_address: professor should address students with 'you'");
  }

  // Rhetorical question
  if (!text.includes("?")) {
    warnings.push("no_questions: lecture should include at least one rhetorical question");
  }

  // Context fields
  if (!item.subject) warnings.push("missing_subject");
  if (!item.topic) warnings.push("missing_topic");
  if (!item.difficulty) warnings.push("missing_difficulty");

  // Q1 must be main_idea
  if (item.questions.length >= 1 && item.questions[0].type !== "main_idea") {
    warnings.push(`q1_not_main_idea: Q1 is "${item.questions[0].type}" (should be main_idea)`);
  }

  // Q type diversity
  const qTypes = item.questions.map(q => q.type).filter(Boolean);
  const uniqueTypes = new Set(qTypes);
  if (uniqueTypes.size < 2) {
    warnings.push("q_type_not_diverse: all questions are the same type");
  }

  // Q type validity
  for (let qi = 0; qi < item.questions.length; qi++) {
    const q = item.questions[qi];
    const prefix = `q${qi + 1}`;
    if (q.type && !VALID_Q_TYPES.includes(q.type)) {
      warnings.push(`${prefix}_invalid_type: "${q.type}"`);
    }
    if (!q.type) warnings.push(`${prefix}_missing_type`);
    if (!q.explanation) warnings.push(`${prefix}_missing_explanation`);
    if (!q.distractor_types || Object.keys(q.distractor_types).length < 3) {
      warnings.push(`${prefix}_missing_distractor_types`);
    }
  }

  // Answer position: check for clustering (no more than 2 same answer in 4 questions)
  if (item.questions.length >= 4) {
    const answerCounts = {};
    item.questions.forEach(q => {
      if (q.answer) answerCounts[q.answer] = (answerCounts[q.answer] || 0) + 1;
    });
    for (const [letter, count] of Object.entries(answerCounts)) {
      if (count >= 3) {
        warnings.push(`answer_clustering: ${letter} appears ${count} times (max 2 per item)`);
      }
    }
  }

  // Per-question option checks
  const convLower = textLower;
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

    if (correctWc > avgOtherWc * 1.5 && correctWc > 10) {
      warnings.push(`${prefix}_correct_is_longest: ${correctWc} vs avg distractor ${Math.round(avgOtherWc)}`);
    }

    // Option length spread
    const validWcs = optWcs.filter(w => w > 0);
    const spread = validWcs.length > 0 ? Math.max(...validWcs) - Math.min(...validWcs) : 0;
    if (spread > 8) {
      warnings.push(`${prefix}_option_length_spread: ${spread} words (target <= 5)`);
    }

    // Ambiguity detection: distractor uses too many lecture keywords
    const distractorKeys = VALID_ANSWERS.filter(k => k !== q.answer);
    for (const k of distractorKeys) {
      if (!q.options[k]) continue;
      const optLower = q.options[k].toLowerCase();
      const optWords = optLower.split(/\s+/).filter(w => w.length > 3);
      const matchCount = optWords.filter(w => convLower.includes(w)).length;
      if (optWords.length > 0 && matchCount / optWords.length > 0.8 && optWords.length >= 4) {
        warnings.push(`${prefix}_ambiguity_risk_${k}: distractor closely mirrors lecture text (${matchCount}/${optWords.length} words match)`);
      }
    }
  }

  return warnings;
}

// -- Level 3: ETS Flavor scoring -----------------------------------------

function scoreFlavor(item) {
  const scores = {};
  const text = item.transcript || "";
  const textLower = text.toLowerCase();

  // 1. Natural spoken register (weight: 0.25)
  const hasContractions = CONTRACTIONS.test(text);
  const dmCount = DISCOURSE_MARKERS.filter(m => textLower.includes(m)).length;
  const hasSpoken = SPOKEN_MARKERS.some(p => p.test(text));
  const noWritten = !WRITTEN_MARKERS.some(p => p.test(text));
  const hasQuestion = text.includes("?");
  const hasYou = /\byou\b/i.test(text);

  let spokenScore = 0;
  if (hasContractions) spokenScore += 0.25;
  if (dmCount >= 4) spokenScore += 0.20;
  else if (dmCount >= 2) spokenScore += 0.10;
  if (hasSpoken) spokenScore += 0.15;
  if (noWritten) spokenScore += 0.10;
  if (hasQuestion) spokenScore += 0.15;
  if (hasYou) spokenScore += 0.15;
  scores.spoken_register = Math.min(1, spokenScore);

  // 2. Concept defined (weight: 0.15)
  const conceptDefined = /\b(called|known as|refers to|term|coined|this is called|this is what)\b/i.test(text);
  scores.concept_defined = conceptDefined ? 1 : 0;

  // 3. Has example/experiment (weight: 0.15)
  const hasExample = /\b(example|experiment|for instance|imagine|think about|study|tested|found that|classic case|demonstration)\b/i.test(text);
  scores.has_example = hasExample ? 1 : 0;

  // 4. Q1 is main_idea (weight: 0.10)
  scores.q1_is_main_idea = (item.questions[0]?.type === "main_idea") ? 1 : 0;

  // 5. Q type diversity (weight: 0.10)
  const qTypes = item.questions.map(q => q.type).filter(Boolean);
  const uniqueTypes = new Set(qTypes);
  scores.q_type_diversity = uniqueTypes.size >= 3 ? 1 : uniqueTypes.size === 2 ? 0.5 : 0;

  // 6. Distractor plausibility (weight: 0.10)
  let distractorScore = 1;
  for (const q of item.questions) {
    if (!q.options || !q.answer) { distractorScore = 0; break; }
    const distractorKeys = VALID_ANSWERS.filter(k => k !== q.answer);
    for (const k of distractorKeys) {
      if (!q.options[k]) { distractorScore -= 0.1; continue; }
      const dWc = wc(q.options[k]);
      if (dWc < 3 || dWc > 18) distractorScore -= 0.05;
    }
    if (!q.distractor_types || Object.keys(q.distractor_types).length < 3) {
      distractorScore -= 0.15;
    }
  }
  scores.distractor_plausibility = Math.max(0, Math.min(1, distractorScore));

  // 7. Correct not always longest (weight: 0.10)
  let longestCount = 0;
  for (const q of item.questions) {
    if (!q.options || !q.answer) continue;
    const optWcs = VALID_ANSWERS.map(k => q.options[k] ? wc(q.options[k]) : 0);
    const correctWc = q.options[q.answer] ? wc(q.options[q.answer]) : 0;
    if (correctWc === Math.max(...optWcs)) longestCount++;
  }
  const totalQs = item.questions.length;
  scores.correct_not_always_longest = longestCount === 0 ? 1 : longestCount <= 1 ? 0.7 : longestCount <= 2 ? 0.3 : 0;

  // 8. Answer position balance (weight: 0.05)
  const answerCounts = {};
  item.questions.forEach(q => {
    if (q.answer) answerCounts[q.answer] = (answerCounts[q.answer] || 0) + 1;
  });
  const maxCount = Math.max(...Object.values(answerCounts));
  scores.answer_position_balance = maxCount <= 2 ? 1 : maxCount <= 3 ? 0.3 : 0;

  // Weighted total
  const weights = {
    spoken_register: 0.25,
    concept_defined: 0.15,
    has_example: 0.15,
    q1_is_main_idea: 0.10,
    q_type_diversity: 0.10,
    distractor_plausibility: 0.10,
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
 * Validate a single LAT item.
 *
 * @param {object} item
 * @returns {{ valid: boolean, errors: string[], warnings: string[], flavor: object }}
 */
function validateLAT(item) {
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
  // Answer distribution (across all questions in all items)
  const dist = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of items) {
    for (const q of (item.questions || [])) {
      if (q.answer && dist[q.answer] !== undefined) dist[q.answer]++;
    }
  }
  const vals = Object.values(dist);
  const balanced = vals.every(v => v > 0) || items.length < 2;

  // Average flavor score
  const flavorScores = items.map(item => scoreFlavor(item).total);
  const avgFlavor = flavorScores.length > 0
    ? Math.round(flavorScores.reduce((a, b) => a + b, 0) / flavorScores.length * 100) / 100
    : 0;

  // Q type distribution
  const qTypeDist = {};
  for (const item of items) {
    for (const q of (item.questions || [])) {
      const t = q.type || "unknown";
      qTypeDist[t] = (qTypeDist[t] || 0) + 1;
    }
  }

  // Subject distribution
  const subjectDist = {};
  for (const item of items) {
    const s = item.subject || "unknown";
    subjectDist[s] = (subjectDist[s] || 0) + 1;
  }

  // Difficulty distribution
  const difficultyDist = {};
  for (const item of items) {
    const d = item.difficulty || "unknown";
    difficultyDist[d] = (difficultyDist[d] || 0) + 1;
  }

  // Register metrics
  let withContractions = 0;
  let withDM = 0;
  let withYou = 0;
  let withQuestion = 0;
  for (const item of items) {
    const text = item.transcript || "";
    if (CONTRACTIONS.test(text)) withContractions++;
    if (DISCOURSE_MARKERS.some(m => text.toLowerCase().includes(m))) withDM++;
    if (/\byou\b/i.test(text)) withYou++;
    if (text.includes("?")) withQuestion++;
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

  // Word count stats
  const wordCounts = items.map(item => wc(item.transcript || ""));
  const avgWordCount = wordCounts.length > 0
    ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length)
    : 0;

  return {
    distribution: dist,
    balanced,
    avgFlavor,
    qTypeDist,
    subjectDist,
    difficultyDist,
    registerMetrics: {
      contractionRate: Math.round(withContractions / items.length * 100),
      discourseMarkerRate: Math.round(withDM / items.length * 100),
      youAddressRate: Math.round(withYou / items.length * 100),
      questionRate: Math.round(withQuestion / items.length * 100),
    },
    correctIsLongestRate,
    avgWordCount,
  };
}

module.exports = { validateLAT, validateBatch, scoreFlavor };
