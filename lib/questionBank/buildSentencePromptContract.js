const VALID_PROMPT_TASK_KINDS = new Set(["ask", "report", "respond", "tell", "explain"]);

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

function isExplicitTaskText(taskText, taskKind = "") {
  const trimmed = normalizeText(taskText);
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  const lower = trimmed.toLowerCase();
  if (/^(tell|describe|explain|share|state|give|complete)\b/.test(lower)) return true;
  if (taskKind === "respond" && /^(what do you say|how do you respond|what do you reply)\b/.test(lower)) return true;
  if (taskKind === "report" && /^(what did|what does|what do)\b/.test(lower)) return true;
  return false;
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
  if (trimmed.endsWith("?")) return true;
  const lower = trimmed.toLowerCase();
  return /^(tell|describe|explain|share|state|give|complete)\b/.test(lower)
    || /\b(what do you ask|what do they ask|what did he ask|what did she ask|what did they ask|what do you say|how do you respond|tell your friend)\b/.test(lower);
}

module.exports = {
  VALID_PROMPT_TASK_KINDS,
  getStructuredPromptParts,
  renderPromptFromParts,
  validateStructuredPromptParts,
  classifyPromptSurface,
  hasExplicitTaskInLegacyPrompt,
};
