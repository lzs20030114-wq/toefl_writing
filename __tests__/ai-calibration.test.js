import {
  calibrateScoreReport,
  hasClearStance,
  reasonSignalCount,
  shouldRaiseDiscussion2To3,
} from "../lib/ai/calibration";

describe("ai calibration helpers", () => {
  test("hasClearStance detects normal stance phrases", () => {
    expect(hasClearStance("I think this policy is useful.")).toBe(true);
    expect(hasClearStance("In my opinion, this is effective.")).toBe(true);
    expect(hasClearStance("This policy is useful.")).toBe(false);
  });

  test("reasonSignalCount counts common reasoning signals", () => {
    const text =
      "I think this is useful because it saves time. Also, for example, students can plan better.";
    expect(reasonSignalCount(text)).toBeGreaterThanOrEqual(3);
  });
});

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
      "In addition, medical teams can transport emergency supplies between regions in a matter of hours.";

    expect(shouldRaiseDiscussion2To3(result, text)).toBe(true);
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
    const text = "I think airplane is important because it is fast and good.";
    const out = calibrateScoreReport("discussion", result, text);
    expect(out.score).toBe(2);
    expect(out.calibration.adjusted).toBe(false);
  });

  test("keeps score 2 when blocked by high-risk tags", () => {
    const result = {
      score: 2,
      band: 2.5,
      summary: "表达问题较多。",
      patterns: [{ tag: "拼写/基础语法", count: 4, summary: "错误密集" }],
    };
    const text =
      "I think airplanes are important because they are fast. Also they help business and travel for example students study abroad.";
    const out = calibrateScoreReport("discussion", result, text);
    expect(out.score).toBe(2);
  });

  test("does not change non-discussion reports", () => {
    const result = { score: 2, band: 2.5, summary: "x" };
    const out = calibrateScoreReport("build", result, "I think...");
    expect(out.score).toBe(2);
  });

  test("lowers inflated email 4/5 to 3 when expression is generic", () => {
    const result = {
      score: 4,
      band: 4.5,
      summary: "语言不错。",
      patterns: [],
    };
    const text =
      "Dear Dr. Thompson,\nI really enjoyed your talk and it left a strong impression on me. " +
      "It connects to my interest and I would like to ask if you can give some brief advice.\nSincerely.";
    const out = calibrateScoreReport("email", result, text);
    expect(out.score).toBe(3);
    expect(out.calibration.adjusted).toBe(true);
  });

  test("keeps email 4 when concrete details are present", () => {
    const result = {
      score: 4,
      band: 4.5,
      summary: "整体完成较好。",
      patterns: [{ tag: "介词搭配", count: 1, summary: "小问题" }],
    };
    const text =
      "Dear Editor,\nLast week I clicked the Submit button and received an error message on your submission page. " +
      "Could you confirm whether my poem was received, and if not, advise how to resubmit before the deadline? " +
      "I can also send the file as an attachment if that is easier for your team.\nSincerely.";
    const out = calibrateScoreReport("email", result, text);
    expect(out.score).toBe(4);
  });

  test("caps email 5 to 4 for high-confidence collocation error", () => {
    const result = {
      score: 5,
      band: 5.5,
      summary: "整体很强。",
      patterns: [],
    };
    const text =
      "Dear Editor,\nI am a subscriber of Verse & Voice and I appreciate your publication.\nSincerely.";
    const out = calibrateScoreReport("email", result, text);
    expect(out.score).toBe(4);
    expect(out.calibration.reason).toBe("email_5_to_4_guardrail");
  });
});
