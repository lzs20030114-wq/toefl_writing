const {
  validateBuildSentenceItem,
  validateBuildSentenceBank,
} = require("../lib/questionBank/buildSentenceSchema");

describe("build sentence bank schema v2", () => {
  test("valid item passes", () => {
    const item = {
      id: "bs2_easy_001",
      difficulty: "easy",
      context: "You missed class and need slides today, right?",
      responseSuffix: "?",
      given: "Could you",
      givenIndex: 2,
      bank: ["send", "me", "the", "slides", "after", "class", "today", "please"],
      answerOrder: ["send", "me", "the", "slides", "after", "class", "today", "please"],
    };
    expect(validateBuildSentenceItem(item, 0)).toEqual([]);
  });

  test("bank must not contain given", () => {
    const item = {
      id: "bs2_easy_002",
      difficulty: "easy",
      context: "Could you send me the file by tonight?",
      given: "Could you",
      givenIndex: 0,
      bank: ["Could you", "send", "me", "the", "file", "by", "tonight", "please"],
      answerOrder: ["Could you", "send", "me", "the", "file", "by", "tonight", "please"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("must not contain given"))).toBe(true);
  });

  test("bank length must be 8-12", () => {
    const item = {
      id: "bs2_easy_003",
      difficulty: "easy",
      context: "Could you send me the file by tonight?",
      given: "I can",
      givenIndex: 1,
      bank: ["review", "it", "today", "for", "you", "now", "please"],
      answerOrder: ["review", "it", "today", "for", "you", "now", "please"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("length must be 8-12"))).toBe(true);
  });

  test("answerOrder must be permutation of bank", () => {
    const item = {
      id: "bs2_easy_004",
      difficulty: "easy",
      context: "Could you send me the file by tonight?",
      given: "Please",
      givenIndex: 0,
      bank: ["submit", "the", "form", "before", "class", "today", "for", "me"],
      answerOrder: ["submit", "the", "file", "before", "class", "today", "for", "me"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("permutation"))).toBe(true);
  });

  test("given half preposition is rejected", () => {
    const item = {
      id: "bs2_easy_005",
      difficulty: "easy",
      context: "Could you send me the file by tonight?",
      given: "to the",
      givenIndex: 0,
      bank: ["bring", "your", "book", "to", "class", "today", "after", "lunch"],
      answerOrder: ["bring", "your", "book", "to", "class", "today", "after", "lunch"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("half preposition phrase"))).toBe(true);
  });

  test("bank validator catches duplicate ids", () => {
    const items = [
      {
        id: "dup",
        difficulty: "easy",
        context: "Could you send me the file by tonight?",
        given: "Please",
        givenIndex: 0,
        bank: ["check", "the", "doc", "before", "class", "today", "for", "me"],
        answerOrder: ["check", "the", "doc", "before", "class", "today", "for", "me"],
      },
      {
        id: "dup",
        difficulty: "easy",
        context: "Could you send me the file by tonight?",
        given: "I can",
        givenIndex: 1,
        bank: ["review", "your", "draft", "after", "dinner", "tonight", "for", "you"],
        answerOrder: ["review", "your", "draft", "after", "dinner", "tonight", "for", "you"],
      },
    ];
    const result = validateBuildSentenceBank(items);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate id"))).toBe(true);
  });

  test("acceptedAnswerOrders allows at most one alternative permutation", () => {
    const item = {
      id: "bs2_easy_006",
      difficulty: "easy",
      context: "Could you send me the file by tonight?",
      given: "Could you",
      givenIndex: 0,
      bank: ["send", "me", "the file", "by", "tonight", "after", "class", "please"],
      answerOrder: ["send", "me", "the file", "by", "tonight", "after", "class", "please"],
      acceptedAnswerOrders: [
        ["send", "me", "the file", "by", "tonight", "class", "after", "please"],
        ["send", "me", "the file", "by", "tonight", "after", "class", "please"],
      ],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("at most one alternative order"))).toBe(true);
  });

  test("acceptedReasons length must not exceed acceptedAnswerOrders length", () => {
    const item = {
      id: "bs2_easy_007",
      difficulty: "easy",
      context: "Could you send me the file by tonight?",
      given: "Could you",
      givenIndex: 0,
      bank: ["send", "me", "the file", "by", "tonight", "after", "class", "please"],
      answerOrder: ["send", "me", "the file", "by", "tonight", "after", "class", "please"],
      acceptedAnswerOrders: [],
      acceptedReasons: ["adverbial_shift"],
    };
    const errors = validateBuildSentenceItem(item, 0);
    expect(errors.some((e) => e.includes("acceptedReasons: length must be <="))).toBe(true);
  });
});
