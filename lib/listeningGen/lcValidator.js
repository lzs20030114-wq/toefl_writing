/**
 * Listen to a Conversation (LC) — Validator
 *
 * Validates generated LC items against quality criteria.
 */

const VALID_ANSWERS = ["A", "B", "C", "D"];

/**
 * Validate a single LC item.
 *
 * @param {object} item
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateLC(item) {
  const errors = [];
  const warnings = [];

  // 1. Required fields
  if (!Array.isArray(item.conversation) || item.conversation.length === 0) {
    errors.push("missing_conversation: conversation array is required");
    return { valid: false, errors, warnings };
  }
  if (!Array.isArray(item.speakers) || item.speakers.length === 0) {
    errors.push("missing_speakers: speakers array is required");
    return { valid: false, errors, warnings };
  }
  if (!Array.isArray(item.questions) || item.questions.length === 0) {
    errors.push("missing_questions: questions array is required");
    return { valid: false, errors, warnings };
  }

  // 2. Exactly 2 speakers
  if (item.speakers.length !== 2) {
    errors.push(`wrong_speaker_count: ${item.speakers.length} speakers (must be exactly 2)`);
  }

  // Validate speaker objects
  for (let si = 0; si < item.speakers.length; si++) {
    const sp = item.speakers[si];
    if (!sp.name || typeof sp.name !== "string") {
      errors.push(`speaker_${si + 1}_missing_name`);
    }
    if (!sp.role || typeof sp.role !== "string") {
      warnings.push(`speaker_${si + 1}_missing_role`);
    }
  }

  // 3. Conversation turns: 6-15
  const turnCount = item.conversation.length;
  if (turnCount < 6) {
    errors.push(`too_few_turns: ${turnCount} (min 6)`);
  } else if (turnCount > 15) {
    errors.push(`too_many_turns: ${turnCount} (max 15)`);
  }

  // 4. Total word count: 80-250
  const totalWords = item.conversation.reduce((sum, turn) => {
    return sum + (turn.text || "").split(/\s+/).length;
  }, 0);
  if (totalWords < 80) {
    errors.push(`conversation_too_short: ${totalWords} words (min 80)`);
  } else if (totalWords > 250) {
    errors.push(`conversation_too_long: ${totalWords} words (max 250)`);
  }

  // 5. Validate conversation turns
  const speakerNames = new Set((item.speakers || []).map(s => s.name));
  const actualSpeakers = new Set();
  for (let ti = 0; ti < item.conversation.length; ti++) {
    const turn = item.conversation[ti];
    if (!turn.speaker || typeof turn.speaker !== "string") {
      errors.push(`turn_${ti + 1}_missing_speaker`);
    } else {
      actualSpeakers.add(turn.speaker);
    }
    if (!turn.text || typeof turn.text !== "string") {
      errors.push(`turn_${ti + 1}_missing_text`);
    }
  }

  // Check that conversation uses exactly the declared speakers
  if (speakerNames.size === 2 && actualSpeakers.size > 0) {
    for (const name of actualSpeakers) {
      if (!speakerNames.has(name)) {
        warnings.push(`undeclared_speaker: "${name}" not in speakers array`);
      }
    }
    if (actualSpeakers.size < 2) {
      errors.push("only_one_speaker_talks: both speakers must participate");
    }
  }

  // 6. Question count: exactly 2
  if (item.questions.length !== 2) {
    errors.push(`wrong_question_count: ${item.questions.length} (must be exactly 2)`);
  }

  if (errors.length > 0) return { valid: false, errors, warnings };

  // 7. Validate each question
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
    if (!q.question_type) {
      warnings.push(`${prefix}_missing_question_type`);
    }

    // Explanation
    if (!q.explanation) {
      warnings.push(`${prefix}_missing_explanation: should explain why answer is correct`);
    }
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

module.exports = { validateLC, validateBatchDistribution };
