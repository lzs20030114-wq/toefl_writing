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
  function makeV2Question(id, answer, chunks, opts = {}) {
    return {
      id,
      prompt: "Prompt",
      answer,
      chunks,
      prefilled: opts.prefilled || [],
      prefilled_positions: opts.prefilled_positions || {},
      distractor: opts.distractor ?? null,
      has_question_mark: opts.has_question_mark ?? answer.trim().endsWith("?"),
      grammar_points: opts.grammar_points || ["embedded question (if)"],
    };
  }

  function makeSchemaValidItems() {
    return [
      makeV2Question("q1", "Do you know if the lab is open tonight?", ["do", "you know", "if", "the lab", "is open", "tonight"], { grammar_points: ["embedded question (if)"] }),
      makeV2Question("q2", "Could you tell me where the notes are posted?", ["could", "tell me", "where", "the notes", "are posted"], { prefilled: ["you"], prefilled_positions: { you: 1 }, grammar_points: ["embedded question (where)"] }),
      makeV2Question("q3", "Have you heard how they solved the problem?", ["have you heard", "how", "they", "solved", "the problem"], { grammar_points: ["embedded question (how)"] }),
      makeV2Question("q4", "Can we find out whether the room is available?", ["can", "we", "find out", "whether", "the room", "is available"], { grammar_points: ["embedded question (whether)"] }),
      makeV2Question("q5", "I wonder how many seats they have.", ["i wonder", "how many", "seats", "they", "have"], { has_question_mark: false, grammar_points: ["embedded question (how many)"] }),
      makeV2Question("q6", "Does anybody know whether it is open all year long?", ["does", "anybody know", "whether", "it is open", "all year", "long", "they"], { distractor: "they", grammar_points: ["embedded question (whether)"] }),
      makeV2Question("q7", "Do you know if it is usually crowded at this time?", ["do", "you know", "if", "it is", "usually crowded", "at this time", "daily"], { distractor: "daily", grammar_points: ["embedded question (if)"] }),
      makeV2Question("q8", "Could you tell me how long each session was?", ["could", "tell me", "how long", "each", "session", "was", "why"], { prefilled: ["you"], prefilled_positions: { you: 1 }, distractor: "why", grammar_points: ["embedded question (how long)"] }),
      makeV2Question("q9", "I wonder if a few classes can be held on Saturdays.", ["i wonder", "if", "a few", "classes", "can be held", "on saturdays"], { has_question_mark: false, grammar_points: ["embedded question (if)", "passive voice"] }),
      makeV2Question("q10", "Have you heard any details about how they filmed it?", ["have you heard", "any details", "about", "how", "they filmed", "it"], { grammar_points: ["embedded question (how)"] }),
    ];
  }

  test("rejects schema-invalid questions", () => {
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
    expect(out.kind).toBe("schema");
  });

  test("format issues fail schema before warning policy is applied", () => {
    const items = makeSchemaValidItems();
    items[0].chunks[0] = "Do"; // format warning: chunks must be lowercase

    const blocked = evaluateForSave(items, { allowWarnings: false });
    expect(blocked.ok).toBe(false);
    expect(blocked.kind).toBe("schema");

    const allowed = evaluateForSave(items, { allowWarnings: true });
    expect(allowed.ok).toBe(false);
    expect(allowed.kind).toBe("schema");
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

  test("acceptedAnswerOrders is emitted only when alternate order passes sentence formatting checks", () => {
    const base = [
      {
        id: "alt_1",
        difficulty: "medium",
        context: "Could you upload the revised file after class today?",
        given: "Could you",
        givenIndex: 0,
        responseSuffix: ".",
        answer: "Could you upload the revised file for our class tonight please on Canvas.",
        has_question_mark: false,
        prefilled_positions: {},
        answerOrder: ["upload", "the revised file", "for", "our class", "tonight", "please", "on", "Canvas"],
        numAcceptableOrders: 2,
        ambiguityScore: 0.2,
      },
    ];
    const out = normalizeItemsForSave(base, { maxBuildAttempts: 20 });
    expect(Array.isArray(out[0].acceptedAnswerOrders)).toBe(true);
    expect(out[0].acceptedAnswerOrders.length).toBeLessThanOrEqual(1);
    if (out[0].acceptedAnswerOrders.length === 1) {
      expect(out[0].acceptedAnswerOrders[0]).toHaveLength(out[0].bank.length);
    }
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

  test("legacy input fields are normalized and emit legacy marker", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const base = [
      {
        id: "legacy_1",
        difficulty: "medium",
        context: "Legacy compatibility check.",
        given: "Could you",
        givenIndex: 0,
        answer: "Could you upload the revised file immediately please using campus portal for review.",
        has_question_mark: false,
        prefilled_positions: {},
        answerOrder: [
          "upload",
          "the revised file",
          "immediately",
          "please",
          "using",
          "campus portal",
          "for review",
        ],
        response: "Could you upload the revised file immediately please using campus portal for review.",
        responseSuffix: ".",
        alternateOrders: [
          [
            "upload",
            "the revised file",
            "please",
            "immediately",
            "using",
            "campus portal",
            "for review",
          ],
        ],
        alternateReasons: ["adverbial_shift"],
      },
    ];

    const out = normalizeItemsForSave(base, { maxBuildAttempts: 10 });
    expect(out).toHaveLength(1);
    expect(Array.isArray(out[0].bank)).toBe(true);
    expect(Array.isArray(out[0].acceptedAnswerOrders)).toBe(true);
    expect(Array.isArray(out[0].acceptedReasons)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[legacy-input] legacy_1 uses:")
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("response -> responseSentence")
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("alternateOrders -> acceptedAnswerOrders")
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("alternateReasons -> acceptedReasons")
    );
  });
});
