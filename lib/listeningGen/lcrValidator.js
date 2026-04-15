/**
 * Listen and Choose a Response (LCR) — Validator v2
 *
 * Three-level validation + ETS flavor scoring.
 * Based on data/listening/profile/lcr-flavor-model.json
 */

const VALID_ANSWERS = ["A", "B", "C", "D"];

// Stop words for content word extraction
const STOP_WORDS = new Set([
  "i", "a", "an", "the", "is", "am", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had", "will", "would", "can", "could",
  "should", "shall", "may", "might", "must", "to", "of", "in", "on", "at",
  "for", "with", "by", "from", "not", "no", "yes", "it", "that", "this",
  "my", "your", "his", "her", "its", "our", "their", "you", "me", "him",
  "them", "we", "they", "and", "or", "but", "if", "so", "than", "just",
  "about", "up", "out", "don't", "didn't", "isn't", "wasn't", "aren't",
  "what", "when", "where", "how", "who", "which", "why", "there", "here",
  "very", "really", "too", "also", "some", "any", "all", "more", "much",
]);

const DISCOURSE_MARKERS = [
  "actually", "well", "as a matter of fact", "how about", "maybe",
  "absolutely", "don't worry", "let's", "oh", "just", "sure",
  "hmm", "right", "okay", "honestly",
];

const CONTRACTIONS = /\b(i'm|i'll|i've|i'd|don't|didn't|doesn't|isn't|aren't|wasn't|weren't|can't|couldn't|won't|wouldn't|shouldn't|it's|that's|there's|here's|what's|who's|he's|she's|we're|they're|you're|let's|haven't|hasn't)\b/i;

// ── Utility functions ──

function wc(s) { return s.split(/\s+/).filter(Boolean).length; }

function contentWords(s) {
  return s.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function sharedContentWords(a, b) {
  const setA = new Set(contentWords(a));
  const setB = new Set(contentWords(b));
  return [...setA].filter(w => setB.has(w));
}

function hasContraction(s) { return CONTRACTIONS.test(s); }

function hasDiscourseMarker(s) {
  const lower = s.toLowerCase();
  return DISCOURSE_MARKERS.some(m => lower.startsWith(m));
}

function isQuestion(s) { return s.trim().endsWith("?"); }

// ── Level 1: Schema validation (hard errors → reject) ──

function validateSchema(item) {
  const errors = [];

  if (!item.speaker || typeof item.speaker !== "string")
    errors.push("missing_speaker");
  if (!item.options || typeof item.options !== "object")
    errors.push("missing_options");
  if (!item.answer || !VALID_ANSWERS.includes(item.answer))
    errors.push(`invalid_answer: "${item.answer}"`);

  if (errors.length > 0) return errors;

  for (const key of VALID_ANSWERS) {
    if (!item.options[key] || typeof item.options[key] !== "string")
      errors.push(`missing_option_${key}`);
  }

  const speakerWc = wc(item.speaker);
  if (speakerWc < 4) errors.push(`speaker_too_short: ${speakerWc} words (min 4)`);
  if (speakerWc > 20) errors.push(`speaker_too_long: ${speakerWc} words (max 20)`);

  for (const key of VALID_ANSWERS) {
    if (!item.options[key]) continue;
    const optWc = wc(item.options[key]);
    if (optWc < 1) errors.push(`option_${key}_empty`);
    if (optWc > 18) errors.push(`option_${key}_too_long: ${optWc} words (max 18)`);
  }

  return errors;
}

// ── Level 2: Profile checks (warnings) ──

function validateProfile(item) {
  const warnings = [];
  const correctText = item.options[item.answer];
  const correctWc = wc(correctText);

  // Correct answer length (ETS avg: 5.7, target ≤10)
  if (correctWc > 12) {
    warnings.push(`correct_too_verbose: ${correctWc} words (ETS avg 5.7, max 10)`);
  }

  // Option length spread (ETS avg range: 2.3 words)
  const optWcs = VALID_ANSWERS.map(k => wc(item.options[k]));
  const spread = Math.max(...optWcs) - Math.min(...optWcs);
  if (spread > 8) {
    warnings.push(`option_length_spread: ${spread} words (target ≤5)`);
  }

  // Correct is longest check
  const avgOtherWc = VALID_ANSWERS.filter(k => k !== item.answer).map(k => wc(item.options[k])).reduce((a, b) => a + b, 0) / 3;
  if (correctWc > avgOtherWc * 1.6 && correctWc > 8) {
    warnings.push(`correct_is_longest: ${correctWc} vs avg distractor ${Math.round(avgOtherWc)}`);
  }

  // Speaker contraction check (ETS: 62.5% have contractions)
  // Not a per-item warning, but tracked for batch analysis

  // Missing explanation
  if (!item.explanation) {
    warnings.push("missing_explanation");
  }

  // Missing distractor types annotation
  if (!item.distractor_types || Object.keys(item.distractor_types).length < 3) {
    warnings.push("missing_or_incomplete_distractor_types");
  }

  // Missing paradigm annotation
  if (!item.answer_paradigm) {
    warnings.push("missing_answer_paradigm");
  }

  // ── Ambiguity detection: distractor might also be a valid response ──
  const speakerLower = item.speaker.toLowerCase();
  const distractorKeys = VALID_ANSWERS.filter(k => k !== item.answer);
  const speakerContentWds = contentWords(item.speaker);

  for (const k of distractorKeys) {
    const optLower = item.options[k].toLowerCase();
    const optContentWds = contentWords(item.options[k]);

    // High lexical overlap between distractor and speaker (≥3 content words)
    const shared = sharedContentWords(item.speaker, item.options[k]);
    if (shared.length >= 3) {
      warnings.push(`ambiguity_risk_${k}: shares ${shared.length} content words with speaker (${shared.join(", ")})`);
    }

    // "Do you know X?" pattern — distractor that answers yes + gives info
    if (/^(do you know|can you|could you|is (it|the|this)|are you|did you|have you)/i.test(item.speaker)) {
      // Distractor starts with "yes" + adds relevant info
      if (/^yes[,.]?\s+/i.test(optLower) && shared.length >= 1) {
        warnings.push(`ambiguity_risk_${k}: starts with "Yes" + shares topic word — may be valid response`);
      }
      // Distractor expresses empathy/shared situation using speaker's keywords
      if (shared.length >= 2 && /^(i (also|haven't|already|usually|need)|me too|same here)/i.test(optLower)) {
        warnings.push(`ambiguity_risk_${k}: expresses shared experience with speaker's keywords`);
      }
    }

    // Distractor gives directional/temporal info when speaker asks where/when
    if (/^(where|when|what time|how do i)/i.test(item.speaker)) {
      if (/^(it('s| is) (on|at|in|near|just|right)|go (to|straight|down)|turn|take the|about (ten|five|twenty|thirty))/i.test(optLower)) {
        warnings.push(`ambiguity_risk_${k}: gives relevant location/time info for a where/when question`);
      }
    }
  }

  return warnings;
}

// ── Level 3: ETS Flavor scoring ──

function scoreFlavor(item) {
  const scores = {};
  const correctText = item.options[item.answer];

  // 1. Indirect correct answer (weight: 0.25)
  // direct_topical scores 0, everything else scores 1
  const paradigm = item.answer_paradigm || "";
  const isIndirect = paradigm !== "direct_topical" && paradigm !== "";
  scores.indirect_answer = isIndirect ? 1 : 0;

  // 2. Word trap distractor present (weight: 0.20)
  const distractorTypes = item.distractor_types || {};
  const hasWordTrap = Object.values(distractorTypes).some(t =>
    /trap|association|polysemy/i.test(t)
  );
  // Also check lexical overlap
  const distractorKeys = VALID_ANSWERS.filter(k => k !== item.answer);
  const hasLexicalOverlap = distractorKeys.some(k =>
    sharedContentWords(item.speaker, item.options[k]).length > 0
  );
  scores.word_trap = (hasWordTrap || hasLexicalOverlap) ? 1 : 0;

  // 3. Distractor type diversity (weight: 0.15)
  const uniqueTypes = new Set(Object.values(distractorTypes));
  scores.distractor_diversity = uniqueTypes.size >= 2 ? 1 : uniqueTypes.size === 1 ? 0.5 : 0;

  // 4. Natural spoken register (weight: 0.15)
  const speakerHasContraction = hasContraction(item.speaker);
  const correctHasDM = hasDiscourseMarker(correctText);
  scores.natural_register = (speakerHasContraction ? 0.6 : 0) + (correctHasDM ? 0.4 : 0.2);

  // 5. Constructive correct tone (weight: 0.10)
  const lower = correctText.toLowerCase();
  const isConstructive = !(/^(no[,.]|i don't|i can't|i won't|never|stop)/i.test(lower));
  scores.constructive_tone = isConstructive ? 1 : 0;

  // 6. Plausible distractors (weight: 0.10)
  // Check that distractors aren't too short (would seem lazy/absurd)
  const distWcs = distractorKeys.map(k => wc(item.options[k]));
  const allPlausibleLength = distWcs.every(w => w >= 3 && w <= 15);
  scores.plausible_distractors = allPlausibleLength ? 1 : 0.5;

  // 7. Length neutrality (weight: 0.05)
  const optWcs = VALID_ANSWERS.map(k => wc(item.options[k]));
  const correctRank = optWcs.filter(w => w > wc(correctText)).length + 1; // 1=longest, 4=shortest
  scores.length_neutrality = correctRank === 1 ? 0 : 1; // penalize if correct is longest

  // Weighted total
  const weights = {
    indirect_answer: 0.25,
    word_trap: 0.20,
    distractor_diversity: 0.15,
    natural_register: 0.15,
    constructive_tone: 0.10,
    plausible_distractors: 0.10,
    length_neutrality: 0.05,
  };

  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += (scores[key] || 0) * weight;
  }

  return { scores, total: Math.round(total * 100) / 100, weights };
}

// ── Main validation function ──

/**
 * Validate a single LCR item.
 *
 * @param {object} item
 * @returns {{ valid: boolean, errors: string[], warnings: string[], flavor: object }}
 */
function validateLCR(item) {
  // Level 1: Schema
  const errors = validateSchema(item);
  if (errors.length > 0) {
    return { valid: false, errors, warnings: [], flavor: null };
  }

  // Level 2: Profile
  const warnings = validateProfile(item);

  // Level 3: Flavor scoring
  const flavor = scoreFlavor(item);

  // Flavor too low → warning (not reject, but logged)
  if (flavor.total < 0.45) {
    warnings.push(`low_flavor_score: ${flavor.total} (target ≥0.70)`);
  }

  return { valid: true, errors: [], warnings, flavor };
}

/**
 * Validate answer distribution + batch-level quality.
 *
 * @param {object[]} items
 * @returns {{ distribution, balanced, avgFlavor, contractionRate, dmRate, paradigmDist, difficultyDist }}
 */
function validateBatch(items) {
  // Answer distribution
  const dist = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of items) {
    if (item.answer && dist[item.answer] !== undefined) dist[item.answer]++;
  }
  const vals = Object.values(dist);
  const balanced = Math.max(...vals) - Math.min(...vals) <= 3;

  // Average flavor score
  const flavorScores = items.map(item => scoreFlavor(item).total);
  const avgFlavor = flavorScores.length > 0
    ? Math.round(flavorScores.reduce((a, b) => a + b, 0) / flavorScores.length * 100) / 100
    : 0;

  // Contraction rate (ETS target: 62.5%)
  const withContraction = items.filter(item => hasContraction(item.speaker)).length;
  const contractionRate = Math.round(withContraction / items.length * 100);

  // Discourse marker in correct answer (ETS target: 37.5%)
  const withDM = items.filter(item => hasDiscourseMarker(item.options[item.answer])).length;
  const dmRate = Math.round(withDM / items.length * 100);

  // Paradigm distribution
  const paradigmDist = {};
  for (const item of items) {
    const p = item.answer_paradigm || "unknown";
    paradigmDist[p] = (paradigmDist[p] || 0) + 1;
  }

  // Difficulty distribution
  const difficultyDist = {};
  for (const item of items) {
    const d = item.difficulty || "unknown";
    difficultyDist[d] = (difficultyDist[d] || 0) + 1;
  }

  return {
    distribution: dist,
    balanced,
    avgFlavor,
    contractionRate,
    dmRate,
    paradigmDist,
    difficultyDist,
  };
}

module.exports = { validateLCR, validateBatch, scoreFlavor };
