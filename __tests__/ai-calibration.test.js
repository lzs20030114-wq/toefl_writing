import { calibrateScoreReport } from "../lib/ai/calibration";

describe("calibrateScoreReport", () => {
  test("raises discussion score 2 -> 3 when guardrail conditions are met", () => {
    const result = {
      score: 2,
      band: 2.5,
      summary: "语言有明显问题。",
      patterns: [
        { tag: "论证不充分", count: 1, summary: "展开一般" },
        { tag: "句式单一", count: 1, summary: "结构偏单一" },
      ],
    };
    const text =
      "I think airplanes are the most important invention because they connect countries quickly. " +
      "Also, they improve business travel and family communication across long distances. " +
      "While other inventions are important, airplanes changed global mobility more directly. " +
      "For example, international students can now study abroad more easily. " +
      "In addition, medical teams can transport emergency supplies between regions in a matter of hours. " +
      "Therefore, airplanes have both economic and humanitarian value for modern societies. " +
      "Another reason is that global conferences and research collaboration depend on fast international mobility, " +
      "which helps experts share knowledge and solve common problems.";
    const out = calibrateScoreReport("discussion", result, text);
    expect(out.score).toBe(3);
    expect(out.band).toBe(3.5);
    expect(out.calibration.adjusted).toBe(true);
  });

  test("keeps score 2 when text is too short", () => {
    const result = {
      score: 2,
      band: 2.5,
      summary: "语言受限。",
      patterns: [{ tag: "论证不充分", count: 2, summary: "缺例子" }],
    };
    const text = "I think airplane is important because it is fast and good for people.";
    const out = calibrateScoreReport("discussion", result, text);
    expect(out.score).toBe(2);
    expect(out.calibration.adjusted).toBe(false);
  });

  test("does not change non-discussion reports", () => {
    const result = { score: 2, band: 2.5, summary: "x" };
    const out = calibrateScoreReport("email", result, "I think...");
    expect(out.score).toBe(2);
    expect(out.calibration).toBeUndefined();
  });
});
