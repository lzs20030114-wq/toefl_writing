/**
 * Listen to an Announcement (LA) — Validator
 *
 * Validates generated LA items against quality criteria.
 */

const VALID_ANSWERS = ["A", "B", "C", "D"];
const VALID_QUESTION_TYPES = ["detail", "inference", "main_idea"];

/**
 * Validate a single LA item.
 *
 * @param {object} item
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateLA(item) {
  const errors = [];
  const warnings = [];

  // 1. Required fields
  if (!item.announcement || typeof item.announcement !== "string") {
    errors.push("missing_announcement: announcement text is required");
    return { valid: false, errors, warnings };
  }
  if (!Array.isArray(item.questions) || item.questions.length === 0) {
    errors.push("missing_questions: questions array is required");
    return { valid: false, errors, warnings };
  }

  // 2. Announcement word count (50-120)
  const announcementWords = item.announcement.split(/\s+/).length;
  if (announcementWords < 50) {
    errors.push(`announcement_too_short: ${announcementWords} words (min 50)`);
  } else if (announcementWords > 120) {
    errors.push(`announcement_too_long: ${announcementWords} words (max 120)`);
  }

  // 3. Question count (2-3)
  if (item.questions.length < 2) {
    errors.push(`too_few_questions: ${item.questions.length} (min 2)`);
  } else if (item.questions.length > 3) {
    errors.push(`too_many_questions: ${item.questions.length} (max 3)`);
  }

  if (errors.length > 0) return { valid: false, errors, warnings };

  // 4. Validate each question
  for (let qi = 0; qi < item.questions.length; qi++) {
    const q = item.questions[qi];
    const prefix = `q${qi + 1}`;

    if (!q.question || typeof q.question !== "string") {
      errors.push(`${prefix}_missing_question: question text is required`);
      continue;
    }
    if (!q.options || typeof q.options !== "object") {
      errors.push(`${prefix}_missing_options: options object is required`);
      continue;
    }
    if (!q.answer || !VALID_ANSWERS.includes(q.answer)) {
      errors.push(`${prefix}_invalid_answer: "${q.answer}" not in A/B/C/D`);
      continue;
    }

    // All 4 options present
    for (const key of VALID_ANSWERS) {
      if (!q.options[key] || typeof q.options[key] !== "string") {
        errors.push(`${prefix}_missing_option_${key}`);
      }
    }

    // Option lengths
    if (!errors.some(e => e.startsWith(`${prefix}_missing_option`))) {
      const optionLengths = VALID_ANSWERS.map((k) => q.options[k].split(/\s+/).length);
      const avgLen = optionLengths.reduce((a, b) => a + b, 0) / 4;
      const correctLen = q.options[q.answer].split(/\s+/).length;

      if (correctLen > avgLen * 1.5 && correctLen > 10) {
        warnings.push(`${prefix}_correct_is_longest: ${correctLen} vs avg ${Math.round(avgLen)}`);
      }

      for (const key of VALID_ANSWERS) {
        const len = q.options[key].split(/\s+/).length;
        if (len < 3) {
          warnings.push(`${prefix}_option_${key}_too_short: ${len} words`);
        }
        if (len > 20) {
          warnings.push(`${prefix}_option_${key}_too_long: ${len} words`);
        }
      }
    }

    // Question type
    if (q.question_type && !VALID_QUESTION_TYPES.includes(q.question_type)) {
      warnings.push(`${prefix}_invalid_question_type: "${q.question_type}"`);
    }
    if (!q.question_type) {
      warnings.push(`${prefix}_missing_question_type: should specify detail/inference/main_idea`);
    }

    // Explanation
    if (!q.explanation) {
      warnings.push(`${prefix}_missing_explanation: should explain why answer is correct`);
    }
  }

  // 5. Speaker role
  if (!item.speaker_role) {
    warnings.push("missing_speaker_role: should specify who is making the announcement");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate answer distribution across all questions in a batch.
 *
 * @param {object[]} items
 * @returns {{ distribution: object, balanced: boolean }}
 */
function validateBatchDistribution(items) {
  const dist = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of items) {
    for (const q of (item.questions || [])) {
      if (q.answer && dist[q.answer] !== undefined) {
        dist[q.answer]++;
      }
    }
  }
  const values = Object.values(dist);
  const max = Math.max(...values);
  const min = Math.min(...values);
  return { distribution: dist, balanced: max - min <= 3 };
}

module.exports = { validateLA, validateBatchDistribution };
