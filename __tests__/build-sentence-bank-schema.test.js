const {
  validateBuildSentenceItem,
  validateBuildSentenceBank,
} = require("../lib/questionBank/buildSentenceSchema");

describe("build sentence bank schema", () => {
  test("valid item passes", () => {
    const item = {
      id: "easy_001",
      difficulty: "easy",
      promptTokens: [
        { type: "text", value: "you should" },
        { type: "blank" },
        { type: "given", value: "for the" },
        { type: "blank" },
        { type: "blank" },
        { type: "blank" },
      ],
      bank: ["sign up", "lab section", "online", "today"],
      answerOrder: ["sign up", "lab section", "online", "today"],
    };
    expect(validateBuildSentenceItem(item, 0)).toEqual([]);
  });

  test("bank must not contain given", () => {
    const item = {
      id: "easy_002",
      difficulty: "easy",
      promptTokens: [
        { type: "blank" },
        { type: "given", value: "on time" },
      ],
      bank: ["on time"],
      answerOrder: ["on time"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("must not contain the given chunk"))).toBe(true);
  });

  test("blank count must equal bank length", () => {
    const item = {
      id: "easy_003",
      difficulty: "easy",
      promptTokens: [
        { type: "blank" },
        { type: "given", value: "at noon" },
      ],
      bank: ["meet", "me"],
      answerOrder: ["meet", "me"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("blank count"))).toBe(true);
  });

  test("answerOrder must be permutation of bank", () => {
    const item = {
      id: "easy_004",
      difficulty: "easy",
      promptTokens: [
        { type: "blank" },
        { type: "given", value: "after class" },
        { type: "blank" },
      ],
      bank: ["come", "by"],
      answerOrder: ["by", "later"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("permutation"))).toBe(true);
  });

  test("bank validator catches duplicate ids", () => {
    const items = [
      {
        id: "dup",
        difficulty: "easy",
        promptTokens: [
          { type: "blank" },
          { type: "given", value: "after class" },
        ],
        bank: ["stay"],
        answerOrder: ["stay"],
      },
      {
        id: "dup",
        difficulty: "easy",
        promptTokens: [
          { type: "blank" },
          { type: "given", value: "after class" },
        ],
        bank: ["leave"],
        answerOrder: ["leave"],
      },
    ];
    const result = validateBuildSentenceBank(items);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate id"))).toBe(true);
  });
});
