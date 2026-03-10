const {
  renderPromptFromParts,
  validateStructuredPromptParts,
  hasExplicitTaskInLegacyPrompt,
  classifyPromptSurface,
} = require("../lib/questionBank/buildSentencePromptContract");
const { validateQuestion } = require("../lib/questionBank/buildSentenceSchema");

describe("build sentence prompt contract", () => {
  test("renders structured prompt from context and explicit task", () => {
    expect(
      renderPromptFromParts("A visitor is speaking with the museum curator", "What do they ask?")
    ).toBe("A visitor is speaking with the museum curator. What do they ask?");
  });

  test("strict structured validation rejects missing explicit task", () => {
    const out = validateStructuredPromptParts(
      {
        prompt_context: "A visitor is asking the museum curator a question.",
        prompt_task_kind: "ask",
        prompt_task_text: "",
      },
      { requireStructured: true }
    );
    expect(out.fatal.some((e) => e.includes("prompt_task_text"))).toBe(true);
  });

  test("strict structured validation rejects background-only task text", () => {
    const out = validateStructuredPromptParts(
      {
        prompt_context: "A visitor is asking the museum curator a question.",
        prompt_task_kind: "ask",
        prompt_task_text: "A visitor is asking the museum curator a question.",
      },
      { requireStructured: true }
    );
    expect(out.fatal.some((e) => e.includes("explicit task"))).toBe(true);
  });

  test("strict structured validation rejects ask/report/respond with separate context sentence", () => {
    const out = validateStructuredPromptParts(
      {
        prompt_context: "A visitor is speaking with the museum curator.",
        prompt_task_kind: "ask",
        prompt_task_text: "What do they ask?",
      },
      { requireStructured: true }
    );
    expect(out.fatal.some((e) => e.includes("prompt_context"))).toBe(true);
  });

  test("strict structured validation rejects ask/report/respond task text without question mark", () => {
    const out = validateStructuredPromptParts(
      {
        prompt_context: "",
        prompt_task_kind: "report",
        prompt_task_text: "What did the museum curator want to know",
      },
      { requireStructured: true }
    );
    expect(out.fatal.some((e) => e.includes("question mark"))).toBe(true);
  });

  test("legacy explicit task detection distinguishes background-only prompts", () => {
    expect(hasExplicitTaskInLegacyPrompt("A visitor is asking the museum curator a question.")).toBe(false);
    expect(hasExplicitTaskInLegacyPrompt("A visitor is speaking with the museum curator. What do they ask?")).toBe(true);
    expect(hasExplicitTaskInLegacyPrompt("You found a great bookstore. Tell your friend about it.")).toBe(true);
    expect(hasExplicitTaskInLegacyPrompt("Where did Emma go?")).toBe(false);
  });

  test("prompt surface classifier spots statement-only prompts", () => {
    expect(classifyPromptSurface("A visitor is asking the museum curator a question.")).toBe("statement-only");
    expect(classifyPromptSurface("A visitor is speaking with the museum curator. What do they ask?")).toBe("background+question");
    expect(classifyPromptSurface("What did he ask?")).toBe("question-only-or-mixed");
  });

  test("schema now fatally rejects background-only legacy prompts", () => {
    const out = validateQuestion({
      id: "legacy_bad_prompt",
      prompt: "A visitor is asking the museum curator a question.",
      answer: "Could you tell me when the new exhibit opens?",
      chunks: ["could", "tell me", "when", "the new exhibit", "opens"],
      prefilled: ["you"],
      prefilled_positions: { you: 1 },
      distractor: null,
      has_question_mark: true,
      grammar_points: ["embedded question (when)"],
    });
    expect(out.fatal.some((e) => e.includes("explicit task"))).toBe(true);
  });

  test("structured validation rejects naked content questions as task text", () => {
    const out = validateStructuredPromptParts(
      {
        prompt_context: "A student is asking the librarian something.",
        prompt_task_kind: "ask",
        prompt_task_text: "Where did Emma go?",
      },
      { requireStructured: true }
    );
    expect(out.fatal.some((e) => e.includes("explicit task"))).toBe(true);
  });
});
