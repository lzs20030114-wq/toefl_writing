import { questionLookupContext, sentenceAround } from "../lib/dict/core";

describe("questionLookupContext（复盘题目区点词的上下文）", () => {
  const passage = "SRM reflects sunlight back into space. CDR lowers greenhouse gas concentrations.";
  const questions = [
    {
      stem: "What is the basic difference between the two categories",
      options: { A: "SRM merely manages solar radiation", B: "It focuses exclusively on warming" },
    },
  ];
  const ctx = questionLookupContext(passage, questions);

  it("原文里有的词取原文那一句", () => {
    expect(sentenceAround(ctx, "sunlight")).toBe("SRM reflects sunlight back into space.");
  });

  it("只在选项里的词落到那一条选项，不和相邻选项连成一句", () => {
    expect(sentenceAround(ctx, "merely")).toBe("SRM merely manages solar radiation.");
    expect(sentenceAround(ctx, "exclusively")).toBe("It focuses exclusively on warming.");
  });

  it("题干也能取到", () => {
    expect(sentenceAround(ctx, "categories")).toBe("What is the basic difference between the two categories.");
  });

  it("没有原文、选项是数组或缺题时不抛错", () => {
    expect(questionLookupContext("", [null, { question: "Why?", options: ["a b", { text: "c d" }] }])).toBe("Why? a b. c d.");
    expect(questionLookupContext("P.", undefined)).toBe("P.");
  });
});
