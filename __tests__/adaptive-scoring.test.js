/**
 * 自适应模考计分（lib/mockExam/adaptiveScoring.js）。
 * 2026-09-09 对齐真考公开信息：两模块所有题等权（ETS 未公布模块权重），lower 路径封顶 4.0。
 */
import { calculateAdaptiveScore } from "../lib/mockExam/adaptiveScoring";

describe("calculateAdaptiveScore：每题等权 + 路径封顶", () => {
  test("rawScore = 两模块答对数 ÷ 总题数，权重 = 各模块题数占比", () => {
    const s = calculateAdaptiveScore(28, 35, 12, 15, "upper");
    expect(s.rawScore).toBe(0.8);
    expect(s.m1Weight).toBe(0.7);
    expect(s.m2Weight).toBe(0.3);
    expect(s.maxBand).toBe(6);
    expect(s.band).toBe(5); // 0.8 × 6 = 4.8 → 5.0
  });

  test("不再是 40/60：M1 全对 M2 全错的分数按题数占比而非 0.4", () => {
    const s = calculateAdaptiveScore(35, 35, 0, 15, "upper");
    expect(s.rawScore).toBe(0.7);
    expect(s.band).toBe(4); // 0.7 × 6 = 4.2 → 4.0
  });

  test("lower 路径满分也封顶 4.0；band 下限 1.0", () => {
    expect(calculateAdaptiveScore(20, 35, 15, 15, "lower").band).toBe(3); // 35/50 × 4 = 2.8 → 3.0
    expect(calculateAdaptiveScore(35, 35, 15, 15, "lower").band).toBe(4);
    expect(calculateAdaptiveScore(0, 35, 0, 15, "upper").band).toBe(1);
  });

  test("某模块题数为 0 时不除零，权重全落在另一模块", () => {
    const s = calculateAdaptiveScore(10, 20, 0, 0, "upper");
    expect(s.rawScore).toBe(0.5);
    expect(s.m1Weight).toBe(1);
    expect(s.m2Weight).toBe(0);
    expect(calculateAdaptiveScore(0, 0, 0, 0, "upper").band).toBe(1);
  });
});
