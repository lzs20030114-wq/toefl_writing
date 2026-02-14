const {
  evaluateForSave,
  normalizeItemsForSave,
  isLeakyOrder,
} = require("../scripts/save-build-sentence-bank");

describe("save-build-sentence-bank quality gates", () => {
  test("rejects hard-fail questions", () => {
    const items = [
      {
        id: "bad_1",
        difficulty: "easy",
        context: "Could you help me after class today?",
        given: "Please",
        givenIndex: 0,
        responseSuffix: ".",
        bank: ["bring", "to the", "her notebook", "today"],
        answerOrder: ["bring", "her notebook", "to the", "today"],
      },
    ];

    const out = evaluateForSave(items, { allowWarnings: false });
    expect(out.ok).toBe(false);
    expect(out.kind).toBe("hard_fail");
    expect(out.hardFails).toHaveLength(1);
  });

  test("warnings are blocked by default and allowed with flag", () => {
    const items = [
      {
        id: "warn_1",
        difficulty: "medium",
        context: "Can we finish this before the review meeting?",
        given: "After class",
        givenIndex: 0,
        responseSuffix: ".",
        bank: ["review", "the file", "with me", "today", "please"],
        answerOrder: ["the file", "review", "today", "with me", "please"],
      },
    ];

    const blocked = evaluateForSave(items, { allowWarnings: false });
    expect(blocked.ok).toBe(false);
    expect(blocked.kind).toBe("warning_blocked");

    const allowed = evaluateForSave(items, { allowWarnings: true });
    expect(allowed.ok).toBe(true);
    expect(allowed.warnings.length).toBeGreaterThan(0);
  });

  test("build from correctChunks creates non-leaky bank order", () => {
    const items = [
      {
        id: "gen_1",
        difficulty: "easy",
        context: "Could you help me after class today?",
        responseSuffix: ".",
        correctChunks: ["Could you", "send me", "the file", "after class", "today"],
      },
    ];
    const normalized = normalizeItemsForSave(items, { shuffleRetries: 60 });
    expect(normalized).toHaveLength(1);
    const q = normalized[0];
    expect(Array.isArray(q.answerOrder)).toBe(true);
    expect(Array.isArray(q.bank)).toBe(true);
    expect(q.given).toBeTruthy();
    expect(Number.isInteger(q.givenIndex)).toBe(true);
    expect(isLeakyOrder(q.bank, q.answerOrder)).toBe(false);
  });
});
