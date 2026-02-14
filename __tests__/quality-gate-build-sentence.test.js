const {
  hardFailReasons,
  warnings,
} = require("../lib/questionBank/qualityGateBuildSentence");

describe("qualityGateBuildSentence v2", () => {
  test("hard-fails on half preposition given", () => {
    const q = {
      id: "bad_1",
      difficulty: "easy",
      context: "Could you help me after class today?",
      given: "to the",
      givenIndex: 0,
      responseSuffix: ".",
      bank: ["bring", "your", "notebook", "right", "after", "class", "today", "please"],
      answerOrder: ["bring", "your", "notebook", "right", "after", "class", "today", "please"],
    };
    const reasons = hardFailReasons(q);
    expect(reasons.some((r) => r.includes("incomplete functional fragment"))).toBe(true);
  });

  test("hard-fails on order leak and fixed given token", () => {
    const q = {
      id: "bad_2",
      difficulty: "easy",
      context: "Could you help me after class today?",
      given: "Please",
      givenIndex: 0,
      responseSuffix: ".",
      bank: ["bring", "your", "notebook", "right", "after", "class", "today", "please"],
      answerOrder: ["bring", "your", "notebook", "right", "after", "class", "today", "please"],
    };
    const reasons = hardFailReasons(q);
    expect(reasons.some((r) => r.includes("fixed starter token"))).toBe(true);
    expect(reasons.some((r) => r.includes("identical"))).toBe(true);
  });

  test("warns on preposition-start given", () => {
    const q = {
      id: "warn_1",
      difficulty: "medium",
      context: "Can we finish the plan before the meeting?",
      given: "After class",
      givenIndex: 2,
      responseSuffix: ".",
      bank: ["we", "can", "review", "the", "outline", "for", "this", "week"],
      answerOrder: ["we", "can", "review", "the", "outline", "for", "this", "week"],
    };
    const list = warnings(q);
    expect(list.some((w) => w.includes("given starts with preposition"))).toBe(true);
  });
});
