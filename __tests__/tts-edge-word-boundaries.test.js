/** edgeTts.wordsFromBoundaries：Edge audio.metadata 的 WordBoundary（100ns 刻度）→ 秒。 */
const { wordsFromBoundaries } = require("../lib/tts/edgeTts");

describe("wordsFromBoundaries", () => {
  test("offset / duration 按 1e7 刻度换算成秒，3 位小数", () => {
    expect(wordsFromBoundaries([
      { type: "WordBoundary", offset: 500000, duration: 2500000, text: "Hello" },
      { type: "WordBoundary", offset: 3100000, duration: 4000000, text: "there," },
    ])).toEqual([
      { text: "Hello", start: 0.05, end: 0.3 },
      { text: "there,", start: 0.31, end: 0.71 },
    ]);
  });
  test("空文本 / 非数字 / 负数的条目丢掉；非数组 → []", () => {
    expect(wordsFromBoundaries([{ offset: 0, duration: 1, text: " " }, { offset: "x", duration: 1, text: "a" }, { offset: -1, duration: 1, text: "a" }])).toEqual([]);
    expect(wordsFromBoundaries(null)).toEqual([]);
  });
});
