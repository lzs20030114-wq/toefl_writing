/**
 * Listen and Choose a Response (LCR) — Validator
 *
 * Validates generated LCR items against quality criteria.
 */

const VALID_ANSWERS = ["A", "B", "C", "D"];

/**
 * Validate a single LCR item.
 *
 * @param {object} item
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateLCR(item) {
  const errors = [];
  const warnings = [];

  // 1. Required fields
  if (!item.speaker || typeof item.speaker !== "string") {
    errors.push("missing_speaker: speaker sentence is required");
    return { valid: false, errors, warnings };
  }
  if (!item.options || typeof item.options !== "object") {
    errors.push("missing_options: options object is required");
    return { valid: false, errors, warnings };
  }
  if (!item.answer || !VALID_ANSWERS.includes(item.answer)) {
    errors.push(`invalid_answer: "${item.answer}" not in A/B/C/D`);
    return { valid: false, errors, warnings };
  }

  // 2. Speaker sentence length
  const speakerWords = item.speaker.split(/\s+/).length;
  if (speakerWords < 5) {
    errors.push(`speaker_too_short: ${speakerWords} words (min 5)`);
  } else if (speakerWords > 25) {
    errors.push(`speaker_too_long: ${speakerWords} words (max 25)`);
  }

  // 3. All 4 options present
  for (const key of VALID_ANSWERS) {
    if (!item.options[key] || typeof item.options[key] !== "string") {
      errors.push(`missing_option_${key}`);
    }
  }

  if (errors.length > 0) return { valid: false, errors, warnings };

  // 4. Option lengths
  const optionLengths = VALID_ANSWERS.map((k) => item.options[k].split(/\s+/).length);
  const avgLen = optionLengths.reduce((a, b) => a + b, 0) / 4;
  const correctLen = item.options[item.answer].split(/\s+/).length;

  // Correct answer shouldn't be consistently the longest
  if (correctLen > avgLen * 1.5 && correctLen > 10) {
    warnings.push(`correct_is_longest: ${correctLen} vs avg ${Math.round(avgLen)}`);
  }

  // Options too short
  for (const key of VALID_ANSWERS) {
    const len = item.options[key].split(/\s+/).length;
    if (len < 3) {
      warnings.push(`option_${key}_too_short: ${len} words`);
    }
    if (len > 20) {
      warnings.push(`option_${key}_too_long: ${len} words`);
    }
  }

  // 5. Check for first person in speaker (should be conversational)
  // This is OK for listening — speakers can say "I"

  // 6. Check pragmatic function exists
  if (!item.pragmatic_function) {
    warnings.push("missing_pragmatic_function: should specify what pragmatic skill is tested");
  }

  // 7. Check explanation exists
  if (!item.explanation) {
    warnings.push("missing_explanation: should explain why answer is correct");
  }

  // 8. Check distractor types
  if (!item.distractor_types) {
    warnings.push("missing_distractor_types: should classify each wrong answer");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate answer distribution across a batch.
 *
 * @param {object[]} items
 * @returns {{ distribution: object, balanced: boolean }}
 */
function validateBatchDistribution(items) {
  const dist = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of items) {
    if (item.answer && dist[item.answer] !== undefined) {
      dist[item.answer]++;
    }
  }
  const values = Object.values(dist);
  const max = Math.max(...values);
  const min = Math.min(...values);
  return { distribution: dist, balanced: max - min <= 2 };
}

module.exports = { validateLCR, validateBatchDistribution };
