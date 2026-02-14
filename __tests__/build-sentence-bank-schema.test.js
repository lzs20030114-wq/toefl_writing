const {
  validateBuildSentenceItem,
  validateBuildSentenceBank,
} = require("../lib/questionBank/buildSentenceSchema");

describe("build sentence bank schema v2", () => {
  test("valid item passes", () => {
    const item = {
      id: "bs2_easy_001",
      difficulty: "easy",
      context: "You missed class and need slides.",
      responseSuffix: "?",
      given: "Could you",
      bank: ["send me", "the slides", "after class", "today"],
      answerOrder: ["send me", "the slides", "after class", "today"],
    };
    expect(validateBuildSentenceItem(item, 0)).toEqual([]);
  });

  test("bank must not contain given", () => {
    const item = {
      id: "bs2_easy_002",
      difficulty: "easy",
      context: "Could you send me the file today?",
      given: "Could you",
      bank: ["Could you", "send me", "the file", "today"],
      answerOrder: ["Could you", "send me", "the file", "today"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("must not contain given"))).toBe(true);
  });

  test("bank length must be >= 4", () => {
    const item = {
      id: "bs2_easy_003",
      difficulty: "easy",
      context: "Could you send me the file today?",
      given: "I can",
      bank: ["review", "it", "today"],
      answerOrder: ["review", "it", "today"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("length must be >= 4"))).toBe(true);
  });

  test("answerOrder must be permutation of bank", () => {
    const item = {
      id: "bs2_easy_004",
      difficulty: "easy",
      context: "Could you send me the file today?",
      given: "Please",
      bank: ["submit", "the form", "before class", "today"],
      answerOrder: ["submit", "the file", "before class", "today"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("permutation"))).toBe(true);
  });

  test("given half preposition is rejected", () => {
    const item = {
      id: "bs2_easy_005",
      difficulty: "easy",
      context: "Could you send me the file today?",
      given: "to the",
      bank: ["bring", "book", "lab", "today"],
      answerOrder: ["bring", "book", "lab", "today"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("half preposition phrase"))).toBe(true);
  });

  test("bank validator catches duplicate ids", () => {
    const items = [
      {
        id: "dup",
        difficulty: "easy",
        context: "Could you send me the file today?",
        given: "Please",
        bank: ["check", "the doc", "before class", "today"],
        answerOrder: ["check", "the doc", "before class", "today"],
      },
      {
        id: "dup",
        difficulty: "easy",
        context: "Could you send me the file today?",
        given: "I can",
        bank: ["review", "your draft", "after dinner", "tonight"],
        answerOrder: ["review", "your draft", "after dinner", "tonight"],
      },
    ];
    const result = validateBuildSentenceBank(items);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate id"))).toBe(true);
  });
});
