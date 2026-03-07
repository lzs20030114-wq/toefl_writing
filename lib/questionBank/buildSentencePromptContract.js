const VALID_PROMPT_TASK_KINDS = new Set(["ask", "report", "respond", "tell", "explain"]);

const TASK_CUE_PATTERNS = {
  ask: [
    /^(what do .+ ask)\b/i,
    /^(how do .+ ask)\b/i,
    /^(what is the question)\b/i,
  ],
  report: [
    /^(what did .+ ask)\b/i,
    /^(what did .+ want)\b/i,
    /^(what did .+ admit)\b/i,
    /^(what did .+ need to know)\b/i,
    /^(what did .+ need to find out)\b/i,
    /^(what did .+ (want to know|wonder|inquire(?: about)?)\b)/i,
    /^(what does .+ (want to know|need to find out)\b)/i,
    /^(what do .+ want to know)\b/i,
    /^(what was .+ curious about)\b/i,
    /^(what was .+ not sure about)\b/i,
    /^(what were .+ curious about)\b/i,
  ],
  respond: [
    /^(what do(?: .+)? say)\b/i,
    /^(what does .+ say)\b/i,
    /^(how do(?: .+)? respond)\b/i,
    /^(what do(?: .+)? reply)\b/i,
    /^(how do(?: .+)? reply)\b/i,
    /^(how do(?: .+)? answer)\b/i,
    /^(what do(?: .+)? tell)\b/i,
    /^(what do you text back)\b/i,
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

  if (!parts.context) fatal.push("prompt_context: must be a non-empty string");
  if (!parts.taskKind) fatal.push("prompt_task_kind: must be a non-empty string");
  if (!parts.taskText) fatal.push("prompt_task_text: must be a non-empty string");
  if (parts.taskKind && !VALID_PROMPT_TASK_KINDS.has(parts.taskKind)) {
    fatal.push(`prompt_task_kind: must be one of ${Array.from(VALID_PROMPT_TASK_KINDS).join(", ")}`);
  }
  if (parts.taskText && !isExplicitTaskText(parts.taskText, parts.taskKind)) {
    fatal.push("prompt_task_text: must contain an explicit task/instruction, not only background context");
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
