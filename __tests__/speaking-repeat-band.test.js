/**
 * Listen & Repeat 练习结果页：把「Score /5」换成 1-6 估分 band。
 *
 * 两件事锁在这里：
 *   1) levelMeanToBand —— 官方 0-5 等级均值 → 0-55 raw → 与模考同一条线性 raw→band 映射；
 *   2) 结果页真的用了它（源码级回归闸，防止有人把 tile 改回 /5）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  levelMeanToBand,
  computeSpeakingRaw,
  rawToSpeakingBand,
  REPEAT_RAW_MAX,
  SPEAKING_RAW_MAX,
} from "../lib/mockExam/speakingBand";

describe("levelMeanToBand — repeat-only 练习的 1-6 估分", () => {
  test("mean 26/7 (七句 3/5/4/5/3/3/3) → 4.5", () => {
    expect(levelMeanToBand(26 / 7)).toBe(4.5);
  });

  test("mean 4 → 5", () => {
    expect(levelMeanToBand(4)).toBe(5);
  });

  test("mean 5 (满分) → 6", () => {
    expect(levelMeanToBand(5)).toBe(6);
  });

  test("mean 0 → 1 (band 有下限, 不会给 0)", () => {
    expect(levelMeanToBand(0)).toBe(1);
  });

  test("mean 2.5 → 3", () => {
    expect(levelMeanToBand(2.5)).toBe(3);
  });

  test("非有限输入一律 null", () => {
    expect(levelMeanToBand(NaN)).toBeNull();
    expect(levelMeanToBand(null)).toBeNull();
    expect(levelMeanToBand(undefined)).toBeNull();
    expect(levelMeanToBand(Infinity)).toBeNull();
    expect(levelMeanToBand("4")).toBeNull();
  });

  test("超过 5 的均值被夹到 5 → 封顶 6", () => {
    expect(levelMeanToBand(5.4)).toBe(6);
    expect(levelMeanToBand(99)).toBe(6);
  });

  test("负数被夹到 0 → 1", () => {
    expect(levelMeanToBand(-3)).toBe(1);
  });

  test("输出始终落在 [1, 6] 的半档格点上", () => {
    for (let m = 0; m <= 5; m += 0.1) {
      const b = levelMeanToBand(m);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(6);
      expect(b * 2).toBe(Math.round(b * 2));
    }
  });

  test("单调不减", () => {
    let prev = -Infinity;
    for (let m = 0; m <= 5; m += 0.05) {
      const b = levelMeanToBand(m);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  // 与模考 raw 结构对齐：把 repeat 那 35 分按比例撑满 55 分，band 应当一致。
  // (直接拿 calculateSpeakingBand(levels, []) 比不了 —— 面试缺考记 0，会把总分拖下去。)
  test("与模考 repeatRaw 口径一致 (按 35→55 放大后同一 band)", () => {
    const levels = [3, 5, 4, 5, 3, 3, 3];
    const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
    const { repeatRaw } = computeSpeakingRaw(levels, []);
    expect(levelMeanToBand(mean)).toBe(
      rawToSpeakingBand((repeatRaw / REPEAT_RAW_MAX) * SPEAKING_RAW_MAX),
    );
  });

  test("同一口径在多组 levels 上都成立", () => {
    const cases = [
      [5, 5, 5, 5, 5, 5, 5],
      [4, 4, 4, 4, 4, 4, 4],
      [2, 2, 2, 2, 2, 2, 2],
      [0, 1, 2, 3, 4, 5],
      [5, 0],
    ];
    for (const levels of cases) {
      const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
      const { repeatRaw } = computeSpeakingRaw(levels, []);
      expect(levelMeanToBand(mean)).toBe(
        rawToSpeakingBand((repeatRaw / REPEAT_RAW_MAX) * SPEAKING_RAW_MAX),
      );
    }
  });
});

// ── 源码级回归闸：结果页 tile 必须是 band，不许退回 Score /5 ────────────────────
describe("RepeatTask 结果页用的是 1-6 band", () => {
  const src = readFileSync(
    resolve(process.cwd(), "components/speaking/RepeatTask.js"),
    "utf8",
  );

  test("结果页 tile 标签是 Est. Band /6", () => {
    expect(src).toContain("Est. Band /6");
  });

  test("接了 levelMeanToBand", () => {
    expect(src).toContain("levelMeanToBand(");
    expect(src).toContain("lib/mockExam/speakingBand");
  });

  test("旧的 Score /5 标签已移除", () => {
    expect(src).not.toContain("Score /5");
  });

  test("band 进了 onComplete 载荷 (才能落进 session)", () => {
    expect(src).toMatch(/averageScore: avgScore,\s*\n\s*band,/);
  });
});
