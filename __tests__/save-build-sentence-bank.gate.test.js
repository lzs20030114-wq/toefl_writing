/** @jest-environment node */
const { evaluateForSave } = require("../scripts/save-build-sentence-bank");

describe("save-build-sentence-bank gate", () => {
  test("rejects hard-fail items", () => {
    const bad = [
      {
        id: "bad_001",
        difficulty: "easy",
        promptTokens: [
          { type: "text", value: "please" },
          { type: "blank" },
          { type: "given", value: "to the" },
          { type: "blank" },
          { type: "blank" },
          { type: "blank" },
        ],
        bank: ["bring", "her notebook", "right after", "class"],
        answerOrder: ["bring", "her notebook", "right after", "class"],
      },
    ];

    const result = evaluateForSave(bad);
    expect(result.ok).toBe(false);
    expect(result.kind).toBe("hard_fail");
    expect(result.hardFails[0].id).toBe("bad_001");
  });

  test("rejects warnings by default", () => {
    const warn = [
      {
        id: "warn_001",
        difficulty: "easy",
        promptTokens: [
          { type: "given", value: "book your" },
          { type: "blank" },
          { type: "blank" },
          { type: "blank" },
          { type: "blank" },
        ],
        bank: ["advising appointment", "for next week", "online", "today"],
        answerOrder: ["advising appointment", "for next week", "online", "today"],
      },
    ];

    const blocked = evaluateForSave(warn);
    expect(blocked.ok).toBe(false);
    expect(blocked.kind).toBe("warning_blocked");

    const allowed = evaluateForSave(warn, { allowWarnings: true });
    expect(allowed.ok).toBe(true);
    expect(allowed.warnings.length).toBeGreaterThan(0);
  });
});

