const {
  matchesFragment,
  isInflectionalVariant,
  classify,
  buildUniquenessPrompt,
  parseAlternatives,
  analyzeBlank,
  checkItemUniqueness,
} = require("../lib/readingGen/ctwUniqueness.js");

describe("ctwUniqueness — pure helpers", () => {
  test("matchesFragment: 候选须以碎片开头且比碎片长", () => {
    expect(matchesFragment("murky", "mu")).toBe(true);
    expect(matchesFragment("muddy", "mu")).toBe(true);
    expect(matchesFragment("mu", "mu")).toBe(false);   // 等长不算
    expect(matchesFragment("clean", "mu")).toBe(false);
  });

  test("isInflectionalVariant: 单复数/时态算变体，近义词不算", () => {
    expect(isInflectionalVariant("sugar", "sugars")).toBe(true);
    expect(isInflectionalVariant("provide", "provides")).toBe(true);
    expect(isInflectionalVariant("murky", "muddy")).toBe(false);
    expect(isInflectionalVariant("on", "of")).toBe(false);
  });

  test("classify: 屈折/功能词/内容三分", () => {
    expect(classify("sug", "sugars", "sugar")).toBe("inflection");
    expect(classify("o", "on", "of")).toBe("function");
    expect(classify("mu", "murky", "muddy")).toBe("content");
  });

  test("analyzeBlank: 过滤不合碎片与原词本身", () => {
    const blank = { original_word: "murky", displayed_fragment: "mu" };
    const r = analyzeBlank(blank, ["murky", "muddy", "clean", "mu"]);
    expect(r.multiSolution).toBe(true);
    expect(r.alternatives.map((a) => a.word)).toEqual(["muddy"]); // clean 不合碎片; mu 等长; murky=原词
  });

  test("analyzeBlank: 上下文锁死唯一解 → 无第二解", () => {
    const blank = { original_word: "on", displayed_fragment: "o" };
    const r = analyzeBlank(blank, ["on"]); // AI 只给出唯一解
    expect(r.multiSolution).toBe(false);
    expect(r.alternatives).toEqual([]);
  });

  test("buildUniquenessPrompt: 含 blanked_text 与逐空碎片，不泄露原词", () => {
    const item = { blanked_text: "Th_ fish hi_ here.", blanks: [
      { displayed_fragment: "Th", original_word: "The" },
      { displayed_fragment: "hi", original_word: "hides" },
    ] };
    const p = buildUniquenessPrompt(item);
    expect(p).toContain("Th_ fish hi_ here.");
    expect(p).toContain('shown letters "Th"');
    expect(p).not.toContain("hides"); // 不能把答案给 AI
  });

  test("parseAlternatives: 容 ```json 包裹与 1-based 键", () => {
    const raw = '```json\n{ "1": ["on"], "2": ["murky", "muddy"] }\n```';
    expect(parseAlternatives(raw)).toEqual({ 0: ["on"], 1: ["murky", "muddy"] });
  });
});

describe("ctwUniqueness — checkItemUniqueness", () => {
  const item = { blanked_text: "The wa_ was mu_.", blanks: [
    { displayed_fragment: "wa", original_word: "water" },
    { displayed_fragment: "mu", original_word: "murky" },
  ] };

  test("聚合出多解空", async () => {
    const callAI = async () => JSON.stringify({ "1": ["water"], "2": ["murky", "muddy"] });
    const r = await checkItemUniqueness(item, callAI);
    expect(r.multiSolutionBlanks).toHaveLength(1);
    expect(r.multiSolutionBlanks[0].index).toBe(1);
    expect(r.multiSolutionBlanks[0].alternatives[0].word).toBe("muddy");
  });

  test("AI 抛错 → error 不抛", async () => {
    const callAI = async () => { throw new Error("network"); };
    const r = await checkItemUniqueness(item, callAI);
    expect(r.error).toMatch(/network/);
    expect(r.multiSolutionBlanks).toEqual([]);
  });

  test("AI 返回垃圾 → parse error 不抛", async () => {
    const callAI = async () => "not json at all";
    const r = await checkItemUniqueness(item, callAI);
    expect(r.error).toMatch(/parse/);
  });
});
