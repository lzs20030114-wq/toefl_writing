import { buildReviewSummary, fmtDuration, pickStats, senseOf } from "../lib/vocab/reviewSummary";

describe("buildReviewSummary", () => {
  const cards = {
    a: { word: "a", display: "Alpha", def: "n. 第一个" },
    b: { word: "b", def: "v. 第二" },
  };
  const base = {
    first: { a: true, b: false, c: true }, tally: { good: 5, again: 2 }, lost: ["b", "gone"],
    infoFor: (w) => cards[w], senseFor: (c) => senseOf(c), startedAt: 1000, endedAt: 1000 + 65000,
  };

  test("首次想起来比例、提问次数、用时；取不到卡的词不进忘了列表", () => {
    const s = buildReviewSummary(base);
    expect(s).toMatchObject({ words: 3, firstGood: 2, firstRate: 67, asks: 7, good: 5, again: 2, duration: "1 分 05 秒", changes: null });
    expect(s.lost).toEqual([{ word: "b", display: "b", sense: "动词 第二" }]);
  });

  test("前后变化：正数带 +、持平 ±0、减少带负号；缺开场或现在的统计就不给", () => {
    const s = buildReviewSummary({ ...base, startStats: { knowledge: 10, mature: 4, learning: 6 }, statsNow: { knowledge: 14, mature: 4, learning: 3 } });
    expect(s.changes.map((c) => [c.label, c.from, c.to, c.delta])).toEqual([
      ["预计记得", 10, 14, "+4"], ["已记牢", 4, 4, "±0"], ["学习中", 6, 3, "-3"],
    ]);
    expect(buildReviewSummary({ ...base, startStats: null, statsNow: { knowledge: 1 } }).changes).toBeNull();
  });

  test("一张都没评分时比例为 0，不除零", () => {
    expect(buildReviewSummary({ ...base, first: {}, tally: { good: 0, again: 0 }, lost: [] })).toMatchObject({ words: 0, firstRate: 0, asks: 0 });
  });

  test("小工具：时长至少 1 秒；统计只挑三项并兜底 0", () => {
    expect(fmtDuration(0)).toBe("0 分 01 秒");
    expect(pickStats(null)).toBeNull();
    expect(pickStats({ knowledge: 3, total: 9 })).toEqual({ knowledge: 3, mature: 0, learning: 0 });
  });
});
