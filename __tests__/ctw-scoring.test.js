import { normalizeWord, isBlankCorrect } from "../lib/reading/ctwScoring";

describe("ctwScoring.isBlankCorrect", () => {
  const blank = { original_word: "murky", displayed_fragment: "mu" };

  test("碎片+补全 = 原词 → 对", () => {
    expect(isBlankCorrect(blank, "rky")).toBe(true);
  });

  test("填错词 → 错", () => {
    expect(isBlankCorrect(blank, "ddy")).toBe(false); // muddy 未登记
  });

  test("accepted_words 里的等价词 → 对", () => {
    const b = { original_word: "sugars", displayed_fragment: "sug", accepted_words: ["sugar"] };
    expect(isBlankCorrect(b, "ar")).toBe(true);   // sugar
    expect(isBlankCorrect(b, "ars")).toBe(true);  // sugars（原词）
    expect(isBlankCorrect(b, "arcane")).toBe(false);
  });

  test("大小写/标点归一", () => {
    const b = { original_word: "The", displayed_fragment: "Th" };
    expect(isBlankCorrect(b, "e")).toBe(true);
    expect(isBlankCorrect(b, "E")).toBe(true);
  });

  test("空输入 → 错，不崩", () => {
    expect(isBlankCorrect(blank, "")).toBe(false);
    expect(isBlankCorrect(blank, undefined)).toBe(false);
  });

  test("不做模糊匹配：多解词未登记就是错，杜绝误判对", () => {
    // 关键回归：接受宽容只来自显式 accepted_words，绝不词干猜测
    const b = { original_word: "provides", displayed_fragment: "prov" };
    expect(isBlankCorrect(b, "ide")).toBe(false); // provide 未登记 → 严格判错
  });

  test("normalizeWord", () => {
    expect(normalizeWord("The,")).toBe("the");
    expect(normalizeWord(null)).toBe("");
  });
});
