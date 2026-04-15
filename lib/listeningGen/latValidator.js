/**
 * Listen to an Academic Talk (LAT) — Validator
 *
 * Validates generated LAT items against quality criteria.
 */

const VALID_ANSWERS = ["A", "B", "C", "D"];
const VALID_QUESTION_TYPES = ["main_idea", "detail", "inference", "function", "organization", "attitude"];

/**
 * Validate a single LAT item.
 *
 * @param {object} item
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateLAT(item) {
  const errors = [];
  const warnings = [];

  // 1. Required fields
  if (!item.lecture || typeof item.lecture !== "string") {
    errors.push("missing_lecture: lecture text is required");
    return { valid: false, errors, warnings };
  }
  if (!Array.isArray(item.questions) || item.questions.length === 0) {
    errors.push("missing_questions: questions array is required");
    return { valid: false, errors, warnings };
  }

  // 2. Lecture word count (100-300)
  const lectureWords = item.lecture.split(/\s+/).length;
  if (lectureWords < 100) {
    errors.push(`lecture_too_short: ${lectureWords} words (min 100)`);
  } else if (lectureWords > 300) {
    errors.push(`lecture_too_long: ${lectureWords} words (max 300)`);
  }

  // 3. Question count (3-5)
  if (item.questions.length < 3) {
    errors.push(`too_few_questions: ${item.questions.length} (min 3)`);
  } else if (item.questions.length > 5) {
    errors.push(`too_many_questions: ${item.questions.length} (max 5)`);
  }

  if (errors.length > 0) return { valid: false, errors, warnings };

  // 4. Check spoken style indicators
  const lectureLC = item.lecture.toLowerCase();
  const discourseMarkers = ["so ", "now,", "now ", "actually", "let me", "here's", "right?", "you know", "what's interesting", "basically"];
  const hasDiscourseMarkers = discourseMarkers.some(m => lectureLC.includes(m));
  const hasContractions = /\b(it's|don't|doesn't|that's|we're|they've|I'm|isn't|aren't|won't|can't|didn't|wasn't|weren't|haven't|hasn't)\b/.test(item.lecture);

  if (!hasDiscourseMarkers && !hasContractions) {
    warnings.push("not_spoken_style: lecture should sound spoken (missing discourse markers and contractions)");
  } else if (!hasDiscourseMarkers) {
    warnings.push("few_discourse_markers: consider adding 'so', 'now', 'actually', etc.");
  } else if (!hasContractions) {
    warnings.push("no_contractions: spoken lectures typically use contractions");
  }

  // 5. Subject and subtopic
  if (!item.subject) {
    warnings.push("missing_subject: should specify the academic subject");
  }
  if (!item.subtopic) {
    warnings.push("missing_subtopic: should specify the specific subtopic");
  }

  // 6. Validate each question
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
      warnings.push(`${prefix}_missing_question_type: should specify main_idea/detail/inference/function/organization/attitude`);
    }

    // Explanation
    if (!q.explanation) {
      warnings.push(`${prefix}_missing_explanation: should explain why answer is correct`);
    }
  }

  // 7. Check question type diversity
  const usedTypes = new Set(item.questions.filter(q => q.question_type).map(q => q.question_type));
  if (usedTypes.size < Math.min(item.questions.length, 3)) {
    warnings.push("low_question_type_diversity: questions should test different skills");
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

module.exports = { validateLAT, validateBatchDistribution };
