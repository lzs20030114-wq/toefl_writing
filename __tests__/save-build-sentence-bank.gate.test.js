const {
  evaluateForSave,
  normalizeItemsForSave,
  tokenizeResponseSentence,
  isLeakyOrder,
  heuristicAmbiguityAssessment,
  countMovableAdverbialChunks,
  summarizeBatch,
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
        bank: ["bring", "your", "notebook", "right", "after", "class", "today", "please"],
        answerOrder: ["bring", "your", "notebook", "right", "after", "class", "today", "please"],
      },
    ];

    const out = evaluateForSave(items, { allowWarnings: false });
    expect(out.ok).toBe(false);
    expect(out.kind).toBe("hard_fail");
  });

  test("warnings are blocked by default and allowed with flag", () => {
    const items = [
      {
        id: "warn_1",
        difficulty: "medium",
        context: "Can we finish this before the review meeting?",
        given: "After class",
        givenIndex: 1,
        responseSuffix: ".",
        bank: ["review", "can", "this", "outline", "we", "week", "the notes", "for"],
        answerOrder: ["can", "we", "review", "the notes", "for", "this", "week", "outline"],
      },
    ];

    const blocked = evaluateForSave(items, { allowWarnings: false });
    expect(blocked.ok).toBe(false);
    expect(blocked.kind).toBe("warning_blocked");

    const allowed = evaluateForSave(items, { allowWarnings: true });
    expect(allowed.ok).toBe(true);
    expect(allowed.warnings.length).toBeGreaterThan(0);
  });

  test("tokenization keeps contractions as single token", () => {
    const out = tokenizeResponseSentence("Don't submit it late tonight.");
    expect(out.tokens).toContain("Don't");
    expect(out.suffix).toBe(".");
  });

  test("normalized generation: givenIndex not always zero and mostly single-token chunks", () => {
    const base = Array.from({ length: 20 }, (_, i) => ({
      id: `g_${i}`,
      difficulty: "easy",
      context: "Could you help me with this assignment today?",
      responseSentence: "Please upload it to Canvas tonight before midnight for this assignment.",
    }));

    const normalized = normalizeItemsForSave(base, { shuffleRetries: 80 });
    const nonZero = normalized.filter((q) => q.givenIndex > 0).length;
    expect(nonZero).toBeGreaterThan(0);

    const avgWordsPerChunk =
      normalized
        .flatMap((q) => q.bank)
        .reduce((sum, c) => sum + c.trim().split(/\s+/).length, 0) /
      normalized.flatMap((q) => q.bank).length;
    expect(avgWordsPerChunk).toBeLessThanOrEqual(1.25);

    normalized.forEach((q) => {
      expect(isLeakyOrder(q.bank, q.answerOrder)).toBe(false);
    });
  });

  test("easy question enforces fixed template family", () => {
    const base = [
      {
        id: "easy_bad_template",
        difficulty: "easy",
        context: "Could you check my draft before class today?",
        responseSentence: "The outline is in my folder on Canvas now.",
      },
    ];
    expect(() => normalizeItemsForSave(base, { maxBuildAttempts: 4 })).toThrow(
      /failed to generate valid question/
    );
  });

  test("heuristic ambiguity assessment rejects high ambiguity via direct fields", () => {
    const base = [
      {
        id: "amb_1",
        difficulty: "medium",
        context: "Could you send me the notes after class today?",
        responseSentence: "Please send me the notes from the lab before midnight tonight.",
        ambiguityScore: 0.7,
      },
    ];
    expect(() => normalizeItemsForSave(base, { maxBuildAttempts: 4 })).toThrow(
      /failed to generate valid question/
    );
  });

  test("acceptedAnswerOrders is emitted for borderline two-order questions", () => {
    const base = [
      {
        id: "alt_1",
        difficulty: "medium",
        context: "Could you upload the revised file after class today?",
        given: "Could you",
        givenIndex: 0,
        responseSuffix: ".",
        answerOrder: ["upload", "the revised file", "for", "our class", "tonight", "please", "on", "Canvas"],
        numAcceptableOrders: 2,
        ambiguityScore: 0.2,
      },
    ];
    const out = normalizeItemsForSave(base, { maxBuildAttempts: 20 });
    expect(out[0].acceptedAnswerOrders).toHaveLength(1);
    expect(out[0].acceptedAnswerOrders[0]).toHaveLength(out[0].bank.length);
  });

  test("adverbial chunk cap helper and batch summary are computed", () => {
    expect(countMovableAdverbialChunks(["review", "the outline", "tonight"])).toBe(1);
    expect(countMovableAdverbialChunks(["review", "in the lab", "tonight"])).toBe(2);

    const summary = summarizeBatch(
      [
        { bank: ["a", "b"], numAcceptableOrders: 1 },
        { bank: ["a", "b", "c"], numAcceptableOrders: 2 },
      ],
      { discarded: 3, discardReasons: { foo: 2, bar: 1 } }
    );
    expect(summary.multiAnswerRatio).toBe(0.5);
    expect(summary.avgBankTokenCount).toBe(2.5);
    expect(summary.discarded).toBe(3);
  });

  test("heuristic ambiguity grows with duplicate and prep-heavy order", () => {
    const low = heuristicAmbiguityAssessment({
      bank: ["review", "the draft", "today", "please"],
      answerOrder: ["review", "the draft", "today", "please"],
    });
    const high = heuristicAmbiguityAssessment({
      bank: ["in", "in", "the lab", "for", "for", "today", "today"],
      answerOrder: ["in", "for", "the lab", "today", "for", "in", "today"],
    });
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.numAcceptableOrders).toBeGreaterThanOrEqual(low.numAcceptableOrders);
  });

  test("invalid alternate order or reason is discarded before save", () => {
    const base = [
      {
        id: "alt_invalid_1",
        difficulty: "medium",
        context: "Could you upload the revised file after class today?",
        given: "Could you",
        givenIndex: 0,
        responseSuffix: ".",
        answerOrder: ["upload", "the revised file", "for", "our class", "tonight", "please", "on", "Canvas"],
        ambiguityScore: 0.1,
        numAcceptableOrders: 1,
        acceptedAnswerOrders: [["upload", "the revised file", "for", "our class", "tonight", "please", "on", "on"]],
        acceptedReasons: ["semantic_shift"],
      },
    ];

    const out = normalizeItemsForSave(base, { maxBuildAttempts: 10 });
    expect(out[0].acceptedAnswerOrders).toEqual([]);
    expect(out[0].acceptedReasons).toEqual([]);
  });
});
