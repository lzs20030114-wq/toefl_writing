const { ETS_STYLE_TARGETS, isEmbeddedQuestion, isNegation } = require("./etsProfile");
const {
  validateStructuredPromptParts,
  hasExplicitTaskInLegacyPrompt,
  isConversationalDialogueTurn,
} = require("./buildSentencePromptContract");

// Does the question-ANSWER merely re-ask the question-PROMPT (vs. genuinely reply)?
// Used by the dialogue-coherence gate. Re-ask signals: same leading wh-word
// ("Where…?" → "Where…?"), both first-person requests ("…do I…?" → "…do I…?"), or heavy
// content-word overlap (asking the same thing in near-synonyms). Deliberately conservative
// — it only fires on clear re-asks so authentic follow-up questions pass.
const _REASK_STOP = new Set(["the","a","an","do","does","did","is","are","was","were","you","your","yours","i","my","me","we","our","us","to","of","in","on","at","for","and","or","if","it","this","that","they","with","about","any","some","be","been","have","has","had","will","would","can","could","please","tell","know","what","when","where","why","how","which","who","there"]);
function _reaskWords(s) {
  return String(s).toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/).filter(Boolean);
}
function _reaskStem(w) {
  // strip common inflections AND a trailing silent-e so "close"/"closes" → same stem
  return w.replace(/(ing|ied|ed|ies|es|s)$/, "").replace(/e$/, "").slice(0, 6);
}
function isReAsk(prompt, answer) {
  const pw = _reaskWords(prompt);
  const aw = _reaskWords(answer);
  const wh = /^(where|what|when|why|how|which|who)$/;
  const sameWh = wh.test(pw[0] || "") && pw[0] === aw[0];
  const fpReq = (s) => /\b(do|does|can|could|should|may|would|will)\s+i\b/i.test(s);
  const bothFirstPersonRequest = fpReq(prompt) && fpReq(answer);
  const promptStems = new Set(pw.filter((w) => !_REASK_STOP.has(w) && w.length > 3).map(_reaskStem));
  const seen = new Set();
  let shared = 0;
  for (const w of aw) {
    if (_REASK_STOP.has(w) || w.length <= 3) continue;
    const st = _reaskStem(w);
    if (promptStems.has(st) && !seen.has(st)) { shared += 1; seen.add(st); }
  }
  return sameWh || bothFirstPersonRequest || shared >= 3;
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalize(s) {
  return String(s || "").trim().toLowerCase();
}

function words(s) {
  return normalize(s)
    .replace(/[.,!?;:]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function isPronounDisplayToken(t) {
  return t === "I" || t === "I'm" || t === "I've" || t === "I'll" || t === "I'd";
}

const PROPER_NOUNS = new Set([
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);

function hasAllowedChunkCase(chunk) {
  return String(chunk || "")
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => token === token.toLowerCase() || isPronounDisplayToken(token) || PROPER_NOUNS.has(token));
}

function validateQuestion(q) {
  const fatal = [];
  const format = [];
  const content = [];

  if (!q || typeof q !== "object" || Array.isArray(q)) {
    return { fatal: ["must be an object"], format: [], content: [] };
  }

  if (!isNonEmptyString(q.id)) fatal.push("id: must be a non-empty string");
  if (!isNonEmptyString(q.prompt)) fatal.push("prompt: must be a non-empty string");
  if (!isNonEmptyString(q.answer)) fatal.push("answer: must be a non-empty string");
  if (!Array.isArray(q.chunks) || q.chunks.length === 0) fatal.push("chunks: must be a non-empty array");
  if (!Array.isArray(q.prefilled)) fatal.push("prefilled: must be an array");
  if (Array.isArray(q.prefilled) && q.prefilled.length > 0) {
    // Per-segment length check. Real TPO has 17% segments at 4+ words
    // ("Unfortunately I", "wanted to know", "at this company to", "the local
    // superstore"). Old rule (>=4 fatal) rejected all of them. Loosened to
    // 6+ as a runaway-guard. Updated 2026-05-29.
    q.prefilled.forEach((pf, idx) => {
      const pfWords = String(pf).trim().split(/\s+/).length;
      if (pfWords >= 6) {
        fatal.push(`prefilled[${idx}] too long (${pfWords} words): keep under 6 words; see PREFILLED_PROFILE in etsProfile.js for TPO distribution`);
      }
    });
    // TPO uses bare subject pronouns (she/he/they) freely as prefilled.
    // Banned: standalone "not" (creates negation ambiguity), and object
    // pronouns him/her/them (TPO doesn't use these as anchor words).
    const BANNED_PREFILLED = new Set(["not", "him", "her", "them"]);
    const pfNorm = q.prefilled[0].trim().toLowerCase();
    if (BANNED_PREFILLED.has(pfNorm)) {
      fatal.push(`prefilled "${q.prefilled[0]}" is a banned word — see PREFILLED_PROFILE for allowed word-type patterns`);
    }
  }
  if (!q.prefilled_positions || typeof q.prefilled_positions !== "object" || Array.isArray(q.prefilled_positions)) {
    fatal.push("prefilled_positions: must be an object");
  }
  if (typeof q.has_question_mark !== "boolean") fatal.push("has_question_mark: must be a boolean");
  if (!Array.isArray(q.grammar_points)) fatal.push("grammar_points: must be an array");

  if (fatal.length > 0) return { fatal, format, content };

  // 2026-06-01 DIALOGUE-COHERENCE gate (calibrated to realExam2026 2-turn dialogue). The
  // prompt is turn 1 and the answer the student assembles is turn 2, the REPLY. When the
  // answer is a QUESTION, the real exam shows it is coherent in several forms — after a
  // STATEMENT opener ("There is a work study position." -> "Do you know if it needs
  // experience?"), or even after a question when it genuinely REPLIES (acknowledges then
  // follows up: "Do you have plans Friday?" -> "No, but what are you planning?"). It is
  // INCOHERENT only when the answer fails to reply:
  //   (a) the prompt is a "Tell me…/Describe…/Explain…" info-request — it expects info, not
  //       a question back; or
  //   (b) the prompt is a question AND the answer just RE-ASKS the same thing (same wh-word,
  //       or both are first-person "do I…" requests, or heavy content overlap) without
  //       acknowledging it.
  // Exemptions: task_kind="ask" (the task explicitly asks for a question) and
  // meta-instruction prompts ("How do you respond?", "What did X ask?") which aren't turns.
  const taskKind = String(q.prompt_task_kind || "").toLowerCase();
  const answerIsQuestion = q.has_question_mark === true || /\?\s*$/.test(String(q.answer).trim());
  if (answerIsQuestion && taskKind !== "ask") {
    const p = String(q.prompt_task_text || q.prompt || "").trim();
    const ans = String(q.answer || "").trim();
    const isMetaInstruction = /^(how do you (respond|ask)|what (do you (say|ask|tell)|did|does))\b/i.test(p);
    if (!isMetaInstruction) {
      const promptIsInfoRequest = /^\s*(tell me\b|describe\b|explain\b)/i.test(p);
      const promptIsQuestion = /\?\s*$/.test(p);
      // An answer opening with an acknowledgment is a genuine reply, never a re-ask.
      const answerAcknowledges = /^(no\b|yes\b|sure\b|sorry\b|well\b|actually\b|maybe\b|not really\b|i'?m not sure\b|hmm\b|oh\b|right\b|of course\b|absolutely\b|definitely\b|yeah\b|nope\b)/i.test(ans);
      if (promptIsInfoRequest) {
        fatal.push("incoherent_dialogue: answer is a question but the prompt asks for information ('Tell me…'/'Describe…') — the answer must SUPPLY the info, not ask another question.");
      } else if (promptIsQuestion && !answerAcknowledges && isReAsk(p, ans)) {
        fatal.push("incoherent_dialogue: answer just RE-ASKS the prompt's question instead of replying — pair a question-answer with a STATEMENT opener, acknowledge first ('No, but…?'), or ask about something new.");
      }
    }
  }

  const promptContract = validateStructuredPromptParts(q, { requireStructured: false });
  promptContract.fatal.forEach((e) => fatal.push(e));
  promptContract.format.forEach((e) => format.push(e));
  if (
    !promptContract.hasStructured &&
    !hasExplicitTaskInLegacyPrompt(q.prompt) &&
    !isConversationalDialogueTurn(q.prompt)
  ) {
    fatal.push("prompt must include an explicit task or be a conversational dialogue turn; background-only narration is not allowed");
  }

  const answerWords = words(q.answer);
  const chunks = q.chunks.map((c) => normalize(c));
  const prefilled = q.prefilled.map((c) => normalize(c));
  const distractor = q.distractor ? normalize(q.distractor) : null;

  const chunkWords = [];
  chunks.forEach((c) => {
    // Only skip the distractor if it is exactly the distractor chunk
    if (distractor && c === distractor) return;
    words(c).forEach((w) => chunkWords.push(w));
  });
  prefilled.forEach((c) => words(c).forEach((w) => chunkWords.push(w)));

  const chunkWordsSorted = [...chunkWords].sort();
  const answerWordsSorted = [...answerWords].sort();
  if (
    chunkWordsSorted.length !== answerWordsSorted.length ||
    !chunkWordsSorted.every((w, i) => w === answerWordsSorted[i])
  ) {
    // If exact token match fails, try a fuzzy match (case-insensitive, ignore punctuation)
    const normalizeBag = (arr) => arr.map(w => w.replace(/['’‘]/g, "'")).sort().join("|");
    if (normalizeBag(chunkWords) !== normalizeBag(answerWords)) {
       fatal.push("chunks (minus distractor) + prefilled words must equal answer words");
    }
  }

  if (distractor) {
    const distractorW = words(distractor);
    const answerLower = normalize(q.answer).replace(/[.,!?;:]/g, "");
    // A distractor is valid if it's NOT in the answer, OR if it's a morphological variant 
    // that doesn't appear in that specific form.
    if (answerLower.split(/\s+/).includes(distractorW.join(" "))) {
      fatal.push("distractor must not appear in answer");
    }
    if (distractorW.length > 1) {
      fatal.push("distractor must be a single word (TPO standard)");
    }
  }

  for (const [chunk, pos] of Object.entries(q.prefilled_positions)) {
    if (!Number.isInteger(pos) || pos < 0) {
      fatal.push(`prefilled_positions["${chunk}"]: position must be a non-negative integer`);
      continue;
    }
    const chunkW = words(chunk);
    // Find where this chunk actually is in the answer words
    const findPos = () => {
      for (let i = 0; i <= answerWords.length - chunkW.length; i++) {
        const slice = answerWords.slice(i, i + chunkW.length);
        if (slice.every((w, idx) => w === chunkW[idx])) return i;
      }
      return -1;
    };
    
    const actualPos = findPos();
    if (actualPos === -1) {
      fatal.push(`prefilled_positions["${chunk}"]: chunk "${chunk}" not found in answer`);
    } else if (actualPos !== pos) {
      // If position is slightly off but unique, we could auto-fix it in the generator, 
      // but here we report it if it's a fatal mismatch.
      const sliceAtPos = answerWords.slice(pos, pos + chunkW.length);
      if (!sliceAtPos.every((w, idx) => w === chunkW[idx])) {
         fatal.push(`prefilled_positions["${chunk}"]: position ${pos} does not match answer (found at ${actualPos})`);
      }
    }
  }

  // Relax: prefilled CAN appear in chunks IF it's a distractor or if multiple occurrences exist in answer
  for (const pf of prefilled) {
    const pfCountInAnswer = answerWords.filter(w => words(pf).includes(w)).length;
    const pfCountInChunks = chunks.filter(c => c === pf).length;
    if (chunks.includes(pf) && pf !== distractor && pfCountInChunks >= pfCountInAnswer) {
       // Only fail if it's truly redundant and not a distractor
       // fatal.push(`prefilled "${pf}" must not also appear in chunks`);
    }
  }

  const effectiveChunks = chunks.filter((c) => c !== distractor);
  if (effectiveChunks.length < 4 || effectiveChunks.length > 8) {
    format.push(`effective chunks count must be 4-8 (got ${effectiveChunks.length})`);
  }

  if (answerWords.length < 7 || answerWords.length > 15) {
    format.push(`answer word count must be 7-15 (got ${answerWords.length})`);
  }

  // Floating adverbs as isolated chunks cause multi-solution ambiguity
  const FLOATING_ADVERBS = new Set([
    "yesterday", "tomorrow", "today", "recently", "finally", "usually",
    "always", "often", "sometimes", "already", "probably", "certainly",
    "definitely", "suddenly", "immediately", "eventually", "perhaps",
    "apparently", "afterwards", "meanwhile", "generally", "occasionally",
  ]);

  q.chunks.forEach((c, i) => {
    if (words(c).length > 3) format.push(`chunks[${i}]: must be at most 3 words`);
    if (!hasAllowedChunkCase(c)) format.push(`chunks[${i}]: must be lowercase (except I/I'm/I've/I'll/I'd)`);
    const cNorm = normalize(c).replace(/[.,!?;:]/g, "").trim();
    if (FLOATING_ADVERBS.has(cNorm) && c !== distractor) {
      fatal.push(`chunks[${i}]: isolated floating adverb "${c}" creates multi-solution ambiguity — bind it to the verb (e.g. "discussed yesterday")`);
    }
  });

  const endsWithQ = q.answer.trim().endsWith("?");
  if (q.has_question_mark !== endsWithQ) {
    format.push("has_question_mark must match answer ending punctuation");
  }

  if (q.grammar_points.length === 0) {
    content.push("grammar_points must not be empty");
  }

  return { fatal, format, content };
}

function validateQuestionSet(input, options = {}) {
  const questions = Array.isArray(input)
    ? input
    : input && Array.isArray(input.questions)
      ? input.questions
      : null;
  const errors = [];
  if (!Array.isArray(questions)) {
    return { ok: false, errors: ["questions must be an array"] };
  }

  const ids = new Set();
  questions.forEach((q, i) => {
    const result = validateQuestion(q);
    const label = `q[${i}]`;
    result.fatal.forEach((e) => errors.push(`${label} FATAL: ${e}`));
    result.format.forEach((e) => errors.push(`${label} FORMAT: ${e}`));
    result.content.forEach((e) => errors.push(`${label} CONTENT: ${e}`));
    if (q && isNonEmptyString(q.id)) {
      if (ids.has(q.id)) errors.push(`${label}: duplicate id "${q.id}"`);
      ids.add(q.id);
    }
  });

  // Allow callers to relax set-level style targets (e.g. last-set assembly)
  const targets = options.styleOverrides
    ? { ...ETS_STYLE_TARGETS, ...options.styleOverrides }
    : ETS_STYLE_TARGETS;

  const hasQMark = questions.filter((q) => q.has_question_mark === true).length;
  const distractorCount = questions.filter((q) => q.distractor != null).length;
  const embeddedCount = questions.filter((q) => isEmbeddedQuestion(q.grammar_points)).length;

  if (hasQMark < targets.qmarkMin || hasQMark > targets.qmarkMax) {
    errors.push(`set: need ${targets.qmarkMin}-${targets.qmarkMax} questions with question mark (got ${hasQMark})`);
  }
  if (distractorCount < targets.distractorMin || distractorCount > targets.distractorMax) {
    errors.push(`set: need ${targets.distractorMin}-${targets.distractorMax} distractor items (got ${distractorCount})`);
  }
  if (embeddedCount < targets.embeddedMin || embeddedCount > targets.embeddedMax) {
    errors.push(`set: need ${targets.embeddedMin}-${targets.embeddedMax} embedded-question items (got ${embeddedCount})`);
  }
  if (targets.negationMin != null) {
    const negCount = questions.filter((q) => isNegation(q.grammar_points)).length;
    if (negCount < targets.negationMin || negCount > targets.negationMax) {
      errors.push(`set: need ${targets.negationMin}-${targets.negationMax} negation items (got ${negCount})`);
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateQuestion,
  validateQuestionSet,
  DIFFICULTIES: new Set(["easy", "medium", "hard"]),
  validateBuildSentenceBank: validateQuestionSet,
};
