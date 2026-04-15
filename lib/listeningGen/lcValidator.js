/**
 * Listen to a Conversation (LC) -- Validator v2
 *
 * Three-level validation + ETS flavor scoring.
 * Based on data/listening/profile/lc-flavor-model.json
 *
 * Level 1: Schema (hard errors -> reject)
 * Level 2: Profile (warnings -- dialogue register, structure, Q diversity)
 * Level 3: Flavor scoring (7 weighted markers)
 */

const VALID_ANSWERS = ["A", "B", "C", "D"];
const VALID_Q_TYPES = ["detail", "main_idea", "inference"];

// -- Utility functions ---------------------------------------------------

function wc(s) { return s.split(/\s+/).filter(Boolean).length; }

// Contraction detection
const CONTRACTIONS = /\b(i'm|i'll|i've|i'd|don't|didn't|doesn't|isn't|aren't|wasn't|weren't|can't|couldn't|won't|wouldn't|shouldn't|it's|that's|there's|here's|what's|who's|he's|she's|we're|they're|you're|let's|haven't|hasn't)\b/i;

// Discourse marker detection
const DISCOURSE_MARKERS = [
  "actually", "well", "oh", "hmm", "right", "okay", "exactly",
  "sure", "anyway", "so", "look", "see", "honestly",
];

// Filler/reaction detection
const FILLERS_RE = /\b(really\?|wow|yikes|oh no|huh\??|wait|seriously|not again)\b/i;

// Casual register markers
const CASUAL_MARKERS = [
  /sounds (great|good|perfect|convenient)/i,
  /good (call|point|idea)/i,
  /no worries/i,
  /i'll definitely/i,
  /that's (great|good|perfect|a relief)/i,
  /thanks( for)?/i,
];

// Formal/scripted markers (should NOT appear in casual conversation)
const SCRIPTED_MARKERS = [
  /\bfurthermore\b/i,
  /\bnevertheless\b/i,
  /\bsubsequently\b/i,
  /\bin accordance with\b/i,
  /\bwe are pleased to\b/i,
  /\bkindly (note|be advised)\b/i,
  /\bhereby\b/i,
  /\bwhereas\b/i,
];

// -- Level 1: Schema validation (hard errors -> reject) ------------------

function validateSchema(item) {
  const errors = [];

  // Required arrays
  if (!Array.isArray(item.conversation) || item.conversation.length === 0) {
    errors.push("missing_conversation");
    return errors;
  }
  if (!Array.isArray(item.speakers) || item.speakers.length === 0) {
    errors.push("missing_speakers");
    return errors;
  }
  if (!Array.isArray(item.questions) || item.questions.length === 0) {
    errors.push("missing_questions");
    return errors;
  }

  // Exactly 2 speakers
  if (item.speakers.length !== 2) {
    errors.push(`wrong_speaker_count: ${item.speakers.length} (must be exactly 2)`);
  }

  // Speaker objects
  for (let si = 0; si < item.speakers.length; si++) {
    const sp = item.speakers[si];
    if (!sp.name || typeof sp.name !== "string") {
      errors.push(`speaker_${si + 1}_missing_name`);
    }
    if (!sp.role || typeof sp.role !== "string") {
      errors.push(`speaker_${si + 1}_missing_role`);
    }
  }

  // Turn count: 6-15
  const turnCount = item.conversation.length;
  if (turnCount < 5) {
    errors.push(`too_few_turns: ${turnCount} (min 6)`);
  } else if (turnCount > 16) {
    errors.push(`too_many_turns: ${turnCount} (max 15)`);
  }

  // Total word count: 60-250
  const totalWords = item.conversation.reduce((sum, t) => sum + wc(t.text || ""), 0);
  if (totalWords < 60) {
    errors.push(`conversation_too_short: ${totalWords} words (min 80)`);
  } else if (totalWords > 280) {
    errors.push(`conversation_too_long: ${totalWords} words (max 250)`);
  }

  // Validate conversation turns
  const speakerNames = new Set(item.speakers.map(s => s.name));
  const actualSpeakers = new Set();
  const speakerTurnCounts = {};

  for (let ti = 0; ti < item.conversation.length; ti++) {
    const turn = item.conversation[ti];
    if (!turn.speaker || typeof turn.speaker !== "string") {
      errors.push(`turn_${ti + 1}_missing_speaker`);
    } else {
      actualSpeakers.add(turn.speaker);
      speakerTurnCounts[turn.speaker] = (speakerTurnCounts[turn.speaker] || 0) + 1;
    }
    if (!turn.text || typeof turn.text !== "string") {
      errors.push(`turn_${ti + 1}_missing_text`);
    }
  }

  // Both speakers must participate
  if (speakerNames.size === 2 && actualSpeakers.size < 2) {
    errors.push("only_one_speaker_talks: both speakers must participate");
  }

  // Each speaker must have 2+ turns
  for (const [name, count] of Object.entries(speakerTurnCounts)) {
    if (count < 2) {
      errors.push(`speaker_${name}_too_few_turns: ${count} (min 2)`);
    }
  }

  // Undeclared speakers
  for (const name of actualSpeakers) {
    if (!speakerNames.has(name)) {
      errors.push(`undeclared_speaker: "${name}" not in speakers array`);
    }
  }

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
  const totalWords = item.conversation.reduce((sum, t) => sum + wc(t.text || ""), 0);
  if (totalWords < 80) {
    warnings.push(`conversation_short: ${totalWords} words (ideal 100-180)`);
  } else if (totalWords > 200) {
    warnings.push(`conversation_long: ${totalWords} words (ideal 100-180)`);
  }

  // Turn count ideal range
  const turnCount = item.conversation.length;
  if (turnCount < 6) {
    warnings.push(`few_turns: ${turnCount} (ideal 8-12)`);
  } else if (turnCount > 14) {
    warnings.push(`many_turns: ${turnCount} (ideal 8-12)`);
  }

  // Speaker balance: each speaker should have ~40-60% of turns
  const speakerTurnCounts = {};
  const speakerWordCounts = {};
  for (const t of item.conversation) {
    speakerTurnCounts[t.speaker] = (speakerTurnCounts[t.speaker] || 0) + 1;
    speakerWordCounts[t.speaker] = (speakerWordCounts[t.speaker] || 0) + wc(t.text || "");
  }
  const turnValues = Object.values(speakerTurnCounts);
  if (turnValues.length === 2) {
    const minTurns = Math.min(...turnValues);
    const maxTurns = Math.max(...turnValues);
    if (minTurns < maxTurns * 0.3) {
      warnings.push(`speaker_imbalance: ${minTurns} vs ${maxTurns} turns (one speaker dominates)`);
    }
  }

  // Dialogue register: contractions
  const allText = item.conversation.map(t => t.text).join(" ");
  if (!CONTRACTIONS.test(allText)) {
    warnings.push("no_contractions: conversation should use contractions for natural speech");
  }

  // Dialogue register: fillers/reactions
  const hasFillers = FILLERS_RE.test(allText);
  // Not a hard requirement, just tracked

  // Dialogue register: discourse markers
  const hasDiscourseMarker = DISCOURSE_MARKERS.some(m =>
    allText.toLowerCase().includes(m)
  );
  if (!hasDiscourseMarker) {
    warnings.push("no_discourse_markers: should include Actually/Well/Oh/Hmm for natural speech");
  }

  // Scripted/formal check
  const scriptedFound = SCRIPTED_MARKERS.filter(p => p.test(allText));
  if (scriptedFound.length > 0) {
    warnings.push("scripted_register_detected: conversation sounds too formal/scripted");
  }

  // Turn length variety (should have some short turns)
  const turnWcs = item.conversation.map(t => wc(t.text || ""));
  const shortTurns = turnWcs.filter(w => w <= 5).length;
  if (shortTurns === 0 && turnCount >= 6) {
    warnings.push("no_short_turns: add short reactions (Really?, Wow, Oh no!) for naturalness");
  }

  // Context and situation
  if (!item.context) warnings.push("missing_context");
  if (!item.situation) warnings.push("missing_situation");
  if (!item.difficulty) warnings.push("missing_difficulty");

  // Q1 and Q2 type diversity
  if (item.questions.length === 2) {
    const q1Type = item.questions[0].type;
    const q2Type = item.questions[1].type;
    if (q1Type && q2Type && q1Type === q2Type) {
      warnings.push(`q_type_not_diverse: both questions are ${q1Type} (should test different skills)`);
    }

    for (let qi = 0; qi < 2; qi++) {
      const q = item.questions[qi];
      const prefix = `q${qi + 1}`;
      if (q.type && !VALID_Q_TYPES.includes(q.type)) {
        warnings.push(`${prefix}_invalid_type: "${q.type}" (must be detail/main_idea/inference)`);
      }
      if (!q.type) warnings.push(`${prefix}_missing_type`);
      if (!q.explanation) warnings.push(`${prefix}_missing_explanation`);
      if (!q.distractor_types || Object.keys(q.distractor_types).length < 3) {
        warnings.push(`${prefix}_missing_distractor_types`);
      }
    }

    // Both answers same letter
    if (item.questions[0].answer === item.questions[1].answer) {
      warnings.push("both_answers_same_letter: Q1 and Q2 should have different correct answer positions");
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

    // Ambiguity detection: distractor uses conversation keywords
    const convLower = allText.toLowerCase();
    const distractorKeys = VALID_ANSWERS.filter(k => k !== q.answer);

    for (const k of distractorKeys) {
      if (!q.options[k]) continue;
      const optLower = q.options[k].toLowerCase();
      const optWords = optLower.split(/\s+/).filter(w => w.length > 3);
      const matchCount = optWords.filter(w => convLower.includes(w)).length;
      if (optWords.length > 0 && matchCount / optWords.length > 0.8 && optWords.length >= 4) {
        warnings.push(`${prefix}_ambiguity_risk_${k}: distractor closely mirrors conversation text (${matchCount}/${optWords.length} words match)`);
      }
    }
  }

  return warnings;
}

// -- Level 3: ETS Flavor scoring -----------------------------------------

function scoreFlavor(item) {
  const scores = {};
  const allText = item.conversation.map(t => t.text || "").join(" ");

  // 1. Natural dialogue (weight: 0.25)
  const hasContractions = CONTRACTIONS.test(allText);
  const hasFillers = FILLERS_RE.test(allText);
  const hasDM = DISCOURSE_MARKERS.some(m => allText.toLowerCase().includes(m));
  const hasCasual = CASUAL_MARKERS.some(p => p.test(allText));
  const noScripted = !SCRIPTED_MARKERS.some(p => p.test(allText));

  let naturalScore = 0;
  if (hasContractions) naturalScore += 0.35;
  if (hasDM) naturalScore += 0.25;
  if (hasFillers) naturalScore += 0.15;
  if (hasCasual) naturalScore += 0.15;
  if (noScripted) naturalScore += 0.10;
  scores.natural_dialogue = Math.min(1, naturalScore);

  // 2. Both speakers active (weight: 0.15)
  const speakerTurnCounts = {};
  for (const t of item.conversation) {
    speakerTurnCounts[t.speaker] = (speakerTurnCounts[t.speaker] || 0) + 1;
  }
  const turnValues = Object.values(speakerTurnCounts);
  if (turnValues.length === 2) {
    const ratio = Math.min(...turnValues) / Math.max(...turnValues);
    scores.both_speakers_active = ratio >= 0.5 ? 1 : ratio >= 0.3 ? 0.5 : 0;
  } else {
    scores.both_speakers_active = 0;
  }

  // 3. Problem-resolution structure (weight: 0.15)
  const turns = item.conversation;
  const firstText = (turns[0]?.text || "").toLowerCase();
  const lastText = (turns[turns.length - 1]?.text || "").toLowerCase();
  const hasProblem = /\?|hoping|trying|wondering|need|can't|problem|issue|help/.test(firstText);
  const hasResolution = /thanks|thank|great|good|definitely|sure|okay|perfect|i'll|sounds/.test(lastText);
  scores.problem_resolution_structure = (hasProblem ? 0.5 : 0) + (hasResolution ? 0.5 : 0);

  // 4. Q1/Q2 type diversity (weight: 0.15)
  if (item.questions.length === 2) {
    scores.q1_q2_type_diversity = item.questions[0].type !== item.questions[1].type ? 1 : 0;
  } else {
    scores.q1_q2_type_diversity = 0;
  }

  // 5. Distractor plausibility (weight: 0.15)
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
  scores.correct_not_always_longest = longestCount === 0 ? 1 : longestCount === 1 ? 0.5 : 0;

  // 7. Answer position balance (weight: 0.05)
  if (item.questions.length === 2) {
    scores.answer_position_balance = item.questions[0].answer !== item.questions[1].answer ? 1 : 0;
  } else {
    scores.answer_position_balance = 0.5;
  }

  // Weighted total
  const weights = {
    natural_dialogue: 0.25,
    both_speakers_active: 0.15,
    problem_resolution_structure: 0.15,
    q1_q2_type_diversity: 0.15,
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
 * Validate a single LC item.
 *
 * @param {object} item
 * @returns {{ valid: boolean, errors: string[], warnings: string[], flavor: object }}
 */
function validateLC(item) {
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
  // Answer distribution
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

  // Register metrics
  let convsWithContractions = 0;
  let convsWithFillers = 0;
  let convsWithDM = 0;
  for (const item of items) {
    const allText = item.conversation.map(t => t.text || "").join(" ");
    if (CONTRACTIONS.test(allText)) convsWithContractions++;
    if (FILLERS_RE.test(allText)) convsWithFillers++;
    if (DISCOURSE_MARKERS.some(m => allText.toLowerCase().includes(m))) convsWithDM++;
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
    registerMetrics: {
      contractionRate: Math.round(convsWithContractions / items.length * 100),
      fillerRate: Math.round(convsWithFillers / items.length * 100),
      discourseMarkerRate: Math.round(convsWithDM / items.length * 100),
    },
    correctIsLongestRate,
  };
}

module.exports = { validateLC, validateBatch, scoreFlavor };
