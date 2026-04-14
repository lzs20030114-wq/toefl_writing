/**
 * Validates AI-generated RDL items against ETS profile targets.
 *
 * Checks:
 * - Text length and structure
 * - Question count and types
 * - Option parallelism and length balance
 * - Correct answer validity
 * - Register markers (contractions, passive, etc.)
 * - Specific detail presence (dates, times, money)
 */

const { RDL_PROFILE, ETS_FLAVOR } = require("../readingBank/readingEtsProfile");

const VALID_GENRES = new Set([
  "email", "text_message", "notice", "social_media", "menu",
  "bill", "poster", "schedule", "advertisement", "memo",
  "syllabus", "flyer", "chat_log", "other",
]);

const VALID_QUESTION_TYPES = new Set([
  "main_idea", "detail", "inference", "tone", "vocabulary_in_context",
]);

const VALID_ANSWERS = new Set(["A", "B", "C", "D"]);

function wc(text) { return text.trim().split(/\s+/).filter(Boolean).length; }

/**
 * Validate a generated RDL item.
 *
 * @param {object} item — generated item { genre, text, format_metadata, questions, difficulty }
 * @returns {{ pass: boolean, errors: string[], warnings: string[] }}
 */
function validateRDLItem(item) {
  const errors = [];
  const warnings = [];

  if (!item || typeof item !== "object") {
    return { pass: false, errors: ["item must be an object"], warnings: [] };
  }

  // ── Text checks ──

  if (!item.text || typeof item.text !== "string" || item.text.trim().length < 20) {
    errors.push("text: must be a non-empty string (min 20 chars)");
    return { pass: false, errors, warnings };
  }

  const textWc = wc(item.text);
  const isShort = item.variant === "short";
  if (isShort) {
    if (textWc < 30 || textWc > 70) {
      errors.push(`text_length: ${textWc} words (short variant needs 30-70)`);
    } else if (textWc < 38 || textWc > 55) {
      warnings.push(`text_length_drift: ${textWc} words (target 40-50 for short)`);
    }
  } else {
    if (textWc < 50 || textWc > 300) {
      errors.push(`text_length: ${textWc} words (need 50-300)`);
    } else if (textWc < 80) {
      warnings.push(`text_short: ${textWc} words (target ≥100)`);
    }
  }

  // Genre
  if (!item.genre || !VALID_GENRES.has(item.genre)) {
    warnings.push(`genre: "${item.genre}" not recognized`);
  }

  // ── Question checks ──

  if (!Array.isArray(item.questions)) {
    errors.push("questions: must be an array");
    return { pass: false, errors, warnings };
  }

  if (isShort) {
    if (item.questions.length !== 2) {
      errors.push(`question_count: ${item.questions.length} (short variant needs exactly 2)`);
    }
  } else if (item.questions.length < 2 || item.questions.length > 4) {
    errors.push(`question_count: ${item.questions.length} (need 2-4)`);
  }

  const answerPositions = [];

  for (let i = 0; i < item.questions.length; i++) {
    const q = item.questions[i];
    const label = `Q${i + 1}`;

    if (!q || typeof q !== "object") {
      errors.push(`${label}: must be an object`);
      continue;
    }

    // Question type
    if (q.question_type && !VALID_QUESTION_TYPES.has(q.question_type)) {
      warnings.push(`${label}: question_type "${q.question_type}" not recognized`);
    }

    // Stem
    if (!q.stem || typeof q.stem !== "string" || q.stem.trim().length < 5) {
      errors.push(`${label}: stem must be a non-empty string`);
    }

    // Options
    if (!q.options || typeof q.options !== "object") {
      errors.push(`${label}: options must be an object with A/B/C/D`);
      continue;
    }
    for (const key of ["A", "B", "C", "D"]) {
      if (!q.options[key] || typeof q.options[key] !== "string" || q.options[key].trim().length === 0) {
        errors.push(`${label}.options.${key}: must be a non-empty string`);
      }
    }

    // Correct answer
    if (!VALID_ANSWERS.has(q.correct_answer)) {
      errors.push(`${label}: correct_answer must be A/B/C/D (got "${q.correct_answer}")`);
    } else {
      answerPositions.push(q.correct_answer);
    }

    // Option length balance
    if (q.options && q.options.A && q.options.B && q.options.C && q.options.D) {
      const lens = [wc(q.options.A), wc(q.options.B), wc(q.options.C), wc(q.options.D)];
      const maxL = Math.max(...lens);
      const minL = Math.min(...lens);

      if (maxL - minL > 8) {
        warnings.push(`${label}: option_length_imbalance (${minL}-${maxL} words, spread=${maxL - minL})`);
      }

      // Check if correct is longest
      if (q.correct_answer && q.options[q.correct_answer]) {
        const correctLen = wc(q.options[q.correct_answer]);
        if (correctLen === maxL && lens.filter(l => l === maxL).length === 1) {
          warnings.push(`${label}: correct_is_longest (${correctLen} vs avg ${(lens.reduce((s,l)=>s+l,0)/4).toFixed(0)})`);
        }
      }
    }

    // Grammatical parallelism check
    if (q.options && q.options.A) {
      const starts = Object.values(q.options).map(o => {
        const first = o.trim().split(/\s/)[0].toLowerCase();
        if (first.match(/^(to|a|an|the|by|it|they|he|she|we)$/)) return first;
        if (first.endsWith("ing")) return "GERUND";
        return "OTHER";
      });
      const unique = new Set(starts);
      if (unique.size > 3) {
        warnings.push(`${label}: low_parallelism (options start differently)`);
      }
    }

    // Semantic category check — all options should describe the same type of thing
    if (q.options && q.options.A) {
      function optCat(t) {
        const s = t.toLowerCase().trim();
        if (s.match(/^(?:to |by |in order to )/)) return "action";
        if (s.match(/^\$?\d/)) return "quantity";
        if (s.match(/^(?:on |at |before |after )\w*\d/)) return "time";
        if (s.match(/^(?:in the |at the |inside |near )/)) return "location";
        return "description";
      }
      const cats = Object.values(q.options).map(optCat);
      if (new Set(cats).size >= 3) {
        warnings.push(`${label}: mixed_option_categories (${[...new Set(cats)].join("/")})`);
      }
    }

    // Absolute language in distractors check
    if (q.options && q.correct_answer) {
      const ABSOLUTES = /\b(?:all|always|never|only|exclusively|every|none|completely|impossible|guaranteed)\b/i;
      const correctHasAbsolute = ABSOLUTES.test(q.options[q.correct_answer] || "");
      const distractorsWithAbsolute = Object.entries(q.options)
        .filter(([k]) => k !== q.correct_answer)
        .filter(([, v]) => ABSOLUTES.test(v)).length;
      if (distractorsWithAbsolute >= 2 && !correctHasAbsolute) {
        warnings.push(`${label}: distractor_absolute_tell (${distractorsWithAbsolute} distractors use absolute words, correct doesn't)`);
      }
    }
  }

  // ── Register checks ──

  const text = item.text;

  // Emails should have greeting
  if (item.genre === "email" && !text.match(/^(?:Dear |Hi |Hello |Hey |Subject:)/m)) {
    warnings.push("email_missing_greeting: emails should start with Dear/Hi or Subject");
  }

  // Notices should be more formal
  if (item.genre === "notice") {
    const contractions = (text.match(/\b\w+'(?:t|re|ve|ll|d|s|m)\b/gi) || []).length;
    if (contractions > 3) {
      warnings.push(`notice_too_informal: ${contractions} contractions (notices should be formal)`);
    }
  }

  // Check for specific details (dates, times, money)
  const hasDate = !!text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
  const hasTime = !!text.match(/\d{1,2}:\d{2}\s*(?:AM|PM|a\.m\.|p\.m\.)/i);
  const hasMoney = !!text.match(/\$\d/);

  if (!hasDate && !hasTime) {
    warnings.push("no_specific_datetime: 60-69% of RDL texts should have dates/times");
  }

  // ── Answer position diversity (within this single item) ──
  if (answerPositions.length >= 3) {
    const unique = new Set(answerPositions);
    if (unique.size === 1) {
      errors.push(`answer_position: all ${answerPositions.length} answers are "${answerPositions[0]}" — must vary`);
    }
  }

  // ── Option inter-overlap check (options should be distinct) ──
  for (let i = 0; i < item.questions.length; i++) {
    const q = item.questions[i];
    if (!q.options) continue;
    const optCWords = Object.values(q.options).map(o =>
      new Set(o.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter(w => w.length > 2))
    );
    // Check if any two options share >60% of their words (too similar)
    for (let a = 0; a < optCWords.length; a++) {
      for (let b = a + 1; b < optCWords.length; b++) {
        const intersection = [...optCWords[a]].filter(w => optCWords[b].has(w)).length;
        const smaller = Math.min(optCWords[a].size, optCWords[b].size);
        if (smaller > 2 && intersection / smaller > 0.6) {
          warnings.push(`Q${i+1}: options too similar (${intersection}/${smaller} shared words)`);
        }
      }
    }
  }

  // ── Answer-text consistency check (correct answer must be supported by text) ──
  for (let i = 0; i < item.questions.length; i++) {
    const q = item.questions[i];
    if (!q.options || !q.correct_answer || !item.text) continue;
    if (q.question_type === "main_idea" || q.question_type === "vocabulary_in_context") continue;

    const correctText = (q.options[q.correct_answer] || "").toLowerCase();
    const passageText = item.text.toLowerCase();
    const correctCW = correctText.replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter(w => w.length > 3);

    if (correctCW.length >= 3) {
      const supported = correctCW.filter(w => passageText.includes(w)).length;
      const ratio = supported / correctCW.length;
      if (ratio < 0.15) {
        warnings.push(`Q${i+1}: answer_weak_support (only ${supported}/${correctCW.length} content words found in text)`);
      }
    }
  }

  // ── Cross-question coverage check (questions should target different parts) ──
  if (item.questions.length >= 3 && item.text) {
    const textSents = item.text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 1);
    if (textSents.length >= 3) {
      const qTargets = item.questions.map(q => {
        if (!q.options || !q.correct_answer || q.question_type === "main_idea") return -1;
        const aCW = (q.options[q.correct_answer] || "").toLowerCase().split(/\s+/).filter(w => w.length > 2);
        let bestSent = -1, bestScore = 0;
        textSents.forEach((s, si) => {
          const sCW = s.toLowerCase().split(/\s+/).filter(w => w.length > 2);
          const score = aCW.filter(w => sCW.includes(w)).length;
          if (score > bestScore) { bestScore = score; bestSent = si; }
        });
        return bestSent;
      });
      const validTargets = qTargets.filter(t => t >= 0);
      if (validTargets.length >= 3 && new Set(validTargets).size === 1) {
        warnings.push("all_questions_same_location: questions should target different parts of the text");
      }
    }
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a batch of RDL items for cross-item quality.
 */
function validateRDLBatch(items) {
  const batchWarnings = [];

  // Answer position distribution across batch
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
      if (pct > 0.40) {
        batchWarnings.push(`answer_skew: ${pos}=${(pct * 100).toFixed(0)}% (target ~25%)`);
      }
      if (pct < 0.10 && totalQ >= 10) {
        batchWarnings.push(`answer_underrepresented: ${pos}=${(pct * 100).toFixed(0)}%`);
      }
    }
  }

  // Genre diversity
  const genres = new Set(items.map(i => i.genre));
  if (items.length >= 5 && genres.size < 2) {
    batchWarnings.push("genre_monotony: batch has only 1 genre");
  }

  return { warnings: batchWarnings, answerDistribution: posCounts };
}

module.exports = { validateRDLItem, validateRDLBatch };
