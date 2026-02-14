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
      responseSuffix: ".",
      bank: ["bring", "her notebook", "right after", "class"],
      answerOrder: ["bring", "her notebook", "right after", "class"],
    };
    const reasons = hardFailReasons(q);
    expect(reasons.some((r) => r.includes("incomplete functional fragment"))).toBe(true);
  });

  test("hard-fails on multiple prep fragments in bank", () => {
    const q = {
      id: "bad_2",
      difficulty: "easy",
      context: "Could you help me after class today?",
      given: "Please",
      responseSuffix: ".",
      bank: ["bring", "to the", "in the", "notebook"],
      answerOrder: ["bring", "notebook", "to the", "in the"],
    };
    const reasons = hardFailReasons(q);
    expect(reasons.some((r) => r.includes("incomplete preposition/link fragment"))).toBe(true);
  });

  test("hard-fails when bank order is identical/too close to answerOrder", () => {
    const q = {
      id: "bad_3",
      difficulty: "easy",
      context: "Could you help me after class today?",
      given: "Please",
      responseSuffix: ".",
      bank: ["send me", "the file", "after class", "today"],
      answerOrder: ["send me", "the file", "after class", "today"],
    };
    const reasons = hardFailReasons(q);
    expect(reasons.some((r) => r.includes("identical"))).toBe(true);
    expect(reasons.some((r) => r.includes("too close"))).toBe(true);
  });

  test("emits warning when given starts with preposition", () => {
    const q = {
      id: "warn_1",
      difficulty: "medium",
      context: "Can we finish the plan before the meeting?",
      given: "After class",
      responseSuffix: ".",
      bank: ["review", "the outline", "with me", "today", "please"],
      answerOrder: ["review", "the outline", "with me", "today", "please"],
    };
    const list = warnings(q);
    expect(list.some((w) => w.includes("given starts with preposition"))).toBe(true);
  });
});
