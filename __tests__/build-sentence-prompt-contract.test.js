const {
  renderPromptFromParts,
  validateStructuredPromptParts,
  hasExplicitTaskInLegacyPrompt,
  classifyPromptSurface,
} = require("../lib/questionBank/buildSentencePromptContract");

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

  test("legacy explicit task detection distinguishes background-only prompts", () => {
    expect(hasExplicitTaskInLegacyPrompt("A visitor is asking the museum curator a question.")).toBe(false);
    expect(hasExplicitTaskInLegacyPrompt("A visitor is speaking with the museum curator. What do they ask?")).toBe(true);
    expect(hasExplicitTaskInLegacyPrompt("You found a great bookstore. Tell your friend about it.")).toBe(true);
  });

  test("prompt surface classifier spots statement-only prompts", () => {
    expect(classifyPromptSurface("A visitor is asking the museum curator a question.")).toBe("statement-only");
    expect(classifyPromptSurface("A visitor is speaking with the museum curator. What do they ask?")).toBe("background+question");
    expect(classifyPromptSurface("What did he ask?")).toBe("question-only-or-mixed");
  });
});
