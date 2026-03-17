const VALID_PROMPT_TASK_KINDS = new Set(["ask", "report", "respond", "yesno", "statement"]);

const TASK_CUE_PATTERNS = {
  ask: [
    /^what (?:do|does|did) .+ ask\b/i,
    /^how (?:do|does|did) .+ ask\b/i,
    /^what is the question\b/i,
    /^what (?:do|does|did) .+ want to (?:know|ask|find out)\b/i,
  ],
  report: [
    /^what (?:do|does|did) .+ (?:ask|want|admit|say|mention|explain|report|announce|claim|discover|learn)\b/i,
    /^what (?:do|does|did) .+ need to (?:know|find out)\b/i,
    /^what (?:do|does|did) .+ (?:want to know|wonder|inquire(?: about)?|find out)\b/i,
    /^what (?:was|were) .+ (?:curious about|not sure about|wondering about)\b/i,
    /^report\b/i,
    /^describe\b/i,
    /^explain\b/i,
    /^summarize\b/i,
    /^mention\b/i,
    /^state\b/i,
    /^recount\b/i,
    /^narrate\b/i,
    /^relay\b/i,
    /^convey\b/i,
    /^indicate\b/i,
    /^note\b/i,
    /^announce\b/i,
    /^inform\b/i,
    /^say\b/i,
    /^express\b/i,
  ],
  respond: [
    /^what (?:do|does|did)(?: .+)? (?:say|respond|reply|answer|tell)\b/i,
    /^how (?:do|does|did)(?: .+)? (?:respond|reply|answer)\b/i,
    /^what (?:do|does|did)(?: .+)? text back\b/i,
    /^how (?:do|does|did)(?: .+)? (?:say|tell)\b/i,
    /^(?:where|why|when) (?:do|does|did|will|would|can|could)\b/i,
    /^tell\b/i,
    /^respond\b/i,
    /^reply\b/i,
    /^answer\b/i,
    /^share\b/i,
    /^say\b/i,
    /^express\b/i,
    /^convey\b/i,
    /^inform\b/i,
    /^let\b/i,
    /^communicate\b/i,
  ],
  yesno: [
    /^(?:did|do|does|are|is|can|could|would|will|have|has|were|was|didn't|don't|doesn't|aren't|isn't|haven't|hasn't|won't|wouldn't|couldn't)\b/i,
  ],
  tell: [
    /^tell\b/i,
    /^describe\b/i,
    /^share\b/i,
    /^state\b/i,
    /^give\b/i,
    /^complete\b/i,
    /^answer\b/i,
  ],
  explain: [
    /^explain\b/i,
    /^describe\b/i,
    /^share\b/i,
    /^state\b/i,
    /^give\b/i,
  ],
};

function normalizeText(value) {
  return String(value || "").trim();
}

function endsWithTerminalPunctuation(text) {
  return /[.!?]$/.test(normalizeText(text));
}

function ensureSentencePunctuation(text, fallback = ".") {
  const trimmed = normalizeText(text);
  if (!trimmed) return "";
  return endsWithTerminalPunctuation(trimmed) ? trimmed : `${trimmed}${fallback}`;
}

function getStructuredPromptParts(question) {
  const context = normalizeText(question?.prompt_context ?? question?.promptContext);
  const taskKind = normalizeText(question?.prompt_task_kind ?? question?.promptTaskKind).toLowerCase();
  const taskText = normalizeText(
    question?.prompt_task_text ?? question?.promptTaskText ?? question?.prompt_instruction
  );
  return {
    context,
    taskKind,
    taskText,
    hasStructured: Boolean(context || taskKind || taskText),
  };
}

function renderPromptFromParts(context, taskText) {
  const safeContext = normalizeText(context);
  const safeTask = normalizeText(taskText);
  if (!safeContext && !safeTask) return "";
  if (!safeContext) return ensureSentencePunctuation(safeTask, safeTask.endsWith("?") ? "?" : ".");
  if (!safeTask) return ensureSentencePunctuation(safeContext);
  return `${ensureSentencePunctuation(safeContext)} ${ensureSentencePunctuation(
    safeTask,
    safeTask.endsWith("?") ? "?" : ".",
  )}`.trim();
}

function sentenceMatchesTaskCue(sentence, taskKind = "") {
  const trimmed = normalizeText(sentence);
  if (!trimmed) return false;
  const allPatterns = Object.values(TASK_CUE_PATTERNS).flat();
  const patterns = taskKind
    ? [...(TASK_CUE_PATTERNS[taskKind] || []), ...allPatterns]
    : allPatterns;
  return patterns.some((pattern) => pattern.test(trimmed));
}

function isExplicitTaskText(taskText, taskKind = "") {
  if (taskKind === "statement") {
    // Statement prompts must be context-setting sentences, not meta-instructions
    const trimmed = normalizeText(taskText).toLowerCase();
    if (/^complete\b/.test(trimmed)) return false; // "Complete the sentence..." is banned
    return true;
  }
  const trimmed = normalizeText(taskText);
  if (!trimmed) return false;
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.some((sentence) => sentenceMatchesTaskCue(sentence, taskKind));
}

function validateStructuredPromptParts(question, options = {}) {
  const requireStructured = options.requireStructured === true;
  const fatal = [];
  const format = [];
  const parts = getStructuredPromptParts(question);

  if (requireStructured && !parts.hasStructured) {
    fatal.push("prompt contract: prompt_context, prompt_task_kind, and prompt_task_text are required");
    return { fatal, format, hasStructured: false, renderedPrompt: "" };
  }

  if (!parts.hasStructured) {
    return {
      fatal,
      format,
      hasStructured: false,
      renderedPrompt: normalizeText(question?.prompt),
    };
  }

  // prompt_context is optional — TPO single-question style embeds context inside the question
  if (!parts.taskKind) fatal.push("prompt_task_kind: must be a non-empty string");
  if (!parts.taskText) fatal.push("prompt_task_text: must be a non-empty string");
  if (parts.taskKind && !VALID_PROMPT_TASK_KINDS.has(parts.taskKind)) {
    fatal.push(`prompt_task_kind: must be one of ${Array.from(VALID_PROMPT_TASK_KINDS).join(", ")}`);
  }
  if (
    parts.taskKind &&
    VALID_PROMPT_TASK_KINDS.has(parts.taskKind) &&
    parts.context
  ) {
    fatal.push("prompt_context: must be empty — embed scene context into the prompt itself");
  }
  if (parts.taskText && !isExplicitTaskText(parts.taskText, parts.taskKind)) {
    fatal.push("prompt_task_text: must contain an explicit task/instruction, not only background context");
  }
  if (
    parts.taskKind &&
    ["ask", "yesno"].includes(parts.taskKind) &&
    parts.taskText &&
    !/\?$/.test(parts.taskText)
  ) {
    fatal.push("prompt_task_text: ask/yesno must end with a question mark");
  }
  if (
    parts.taskKind &&
    ["report", "respond"].includes(parts.taskKind) &&
    parts.taskText &&
    !/[.!?]$/.test(parts.taskText)
  ) {
    fatal.push("prompt_task_text: report/respond must end with punctuation (. ! or ?)");
  }
  if (
    parts.taskKind === "statement" &&
    parts.taskText &&
    !/[.!]$/.test(parts.taskText)
  ) {
    fatal.push("prompt_task_text: statement must end with a period or exclamation mark");
  }

  const renderedPrompt = renderPromptFromParts(parts.context, parts.taskText);
  if (!renderedPrompt) {
    fatal.push("prompt contract: could not render prompt from prompt_context + prompt_task_text");
  }

  const prompt = normalizeText(question?.prompt);
  if (prompt && renderedPrompt && prompt !== renderedPrompt) {
    format.push("prompt should match rendered prompt from prompt_context + prompt_task_text");
  }

  return { fatal, format, hasStructured: true, renderedPrompt };
}

function classifyPromptSurface(prompt) {
  const trimmed = normalizeText(prompt);
  if (!trimmed) return "empty";
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length >= 2 && /\?$/.test(sentences[sentences.length - 1])) return "background+question";
  if (/\?$/.test(trimmed)) return "question-only-or-mixed";
  return "statement-only";
}

function hasExplicitTaskInLegacyPrompt(prompt) {
  const trimmed = normalizeText(prompt);
  if (!trimmed) return false;
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.some((sentence) => sentenceMatchesTaskCue(sentence));
}

module.exports = {
  VALID_PROMPT_TASK_KINDS,
  getStructuredPromptParts,
  renderPromptFromParts,
  validateStructuredPromptParts,
  classifyPromptSurface,
  hasExplicitTaskInLegacyPrompt,
  sentenceMatchesTaskCue,
};
