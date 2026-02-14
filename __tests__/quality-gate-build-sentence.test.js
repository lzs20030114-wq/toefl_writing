const {
  hardFailReasons,
  warnings,
} = require("../lib/questionBank/qualityGateBuildSentence");

describe("qualityGateBuildSentence", () => {
  test("hard-fails prepositional given inserted between verb and object", () => {
    const q = {
      id: "bad_001",
      difficulty: "easy",
      promptTokens: [
        { type: "text", value: "please" },
        { type: "blank" },
        { type: "given", value: "to the biology lab" },
        { type: "blank" },
        { type: "blank" },
        { type: "blank" },
      ],
      bank: ["bring", "her notebook", "right after", "class"],
      answerOrder: ["bring", "her notebook", "right after", "class"],
    };

    const reasons = hardFailReasons(q);
    expect(reasons.length).toBeGreaterThan(0);
    expect(
      reasons.some(
        (r) =>
          r.includes("splits verb and direct object") ||
          r.includes("ordering risk")
      )
    ).toBe(true);
  });

  test("hard-fails incomplete given preposition fragment", () => {
    const q = {
      id: "bad_002",
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
    };
    const reasons = hardFailReasons(q);
    expect(reasons.some((r) => r.includes("incomplete prepositional fragment"))).toBe(true);
  });

  test("warning for given chunk at boundary", () => {
    const q = {
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
    };
    expect(hardFailReasons(q)).toEqual([]);
    expect(warnings(q).some((w) => w.includes("sentence boundary"))).toBe(true);
  });
});
