import { formatTyped, lettersOf, missedLetters, sanitizeSpelling, spellingCorrect, spellingSlots } from "../lib/vocab/spelling";

describe("拼写格子（lib/vocab/spelling）", () => {
  test("一个字母一个格；短语里的空格、连字符、撇号原样摆出来，不用敲", () => {
    expect(spellingSlots("cell").map((s) => s.letter)).toEqual([true, true, true, true]);
    expect(spellingSlots("take off").filter((s) => s.letter)).toHaveLength(7);
    expect(spellingSlots("well-known").filter((s) => !s.letter).map((s) => s.ch)).toEqual(["-"]);
  });

  test("输入只留字母、统一小写，最多敲到格子数为止", () => {
    expect(sanitizeSpelling("Approx imately!!", "approximately")).toBe("approximately");
    expect(sanitizeSpelling("approximatelyyyy", "approximately")).toBe("approximately");
    expect(sanitizeSpelling("take off", "take off")).toBe("takeoff");
  });

  test("核对只比字母：短语不用自己打空格", () => {
    expect(spellingCorrect("takeoff", "take off")).toBe(true);
    expect(spellingCorrect("Approximately", "approximately")).toBe(true);
    expect(spellingCorrect("aproximately", "approximately")).toBe(false);
    expect(spellingCorrect("", "")).toBe(false);
  });

  test("「你写的是」按词的样子摆回分隔符", () => {
    expect(formatTyped("takeof", "take off")).toBe("take of");
    expect(formatTyped("aproximately", "approximately")).toBe("aproximately");
  });

  test("对齐标错：漏写一个字母只标那一个，不会把后面整串带歪", () => {
    const missed = missedLetters("aproximately", "approximately");
    expect(missed.filter(Boolean)).toHaveLength(1);
    expect(lettersOf("approximately")[missed.indexOf(true)]).toBe("p");
  });

  test("ie / ei 写反只标出那一处；完全没写就全标", () => {
    const missed = missedLetters("recieve", "receive");
    expect(missed.filter(Boolean)).toHaveLength(1);
    expect([3, 4]).toContain(missed.indexOf(true)); // rec[e][i]ve 中的一个
    expect(missedLetters("", "cell")).toEqual([true, true, true, true]);
  });
});
