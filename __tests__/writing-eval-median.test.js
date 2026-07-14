/**
 * 写作评分「三路取中位」
 * 覆盖:pickMedianCandidate 纯函数(n=3 中位/并列/乱序、n=2 取低、n=1、空/非数组)
 * 与 evaluateWritingResponse 集成(选中中位候选、scoreSamples 顺序含 null、全失败 throw)。
 *
 * client.callAIMulti 被 mock(不打真网络);parse + calibration 用真实实现,
 * prompt 构造被 mock 掉以隔离出中位选择逻辑。
 */

jest.mock("../lib/ai/client", () => ({ callAIMulti: jest.fn() }));
jest.mock("../lib/ai/prompts/emailWriting", () => ({
  getEmailSystemPrompt: () => "SYS",
  buildEmailUserPrompt: () => "USER",
}));
jest.mock("../lib/ai/prompts/academicWriting", () => ({
  getDiscussionSystemPrompt: () => "SYS",
  buildDiscussionUserPrompt: () => "USER",
}));

import { callAIMulti } from "../lib/ai/client";
import { evaluateWritingResponse, pickMedianCandidate, recoverCompleteComparison } from "../lib/ai/writingEval";

// 一份合法 section-format 评分文本,三维与总分同值 → email/150词 校准后 final ≈ score。
function rawWithScore(score) {
  return [
    "===SCORE===",
    `score: ${score}`,
    `band: ${score}`,
    "summary: test summary",
    `维度-任务完成: ${score}`,
    `维度-组织连贯: ${score}`,
    `维度-语言使用: ${score}`,
    "",
    "===ANNOTATION===",
    "The student wrote a reasonably clear essay here.",
  ].join("\n");
}

function makeWords(n) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

describe("pickMedianCandidate", () => {
  test("n=3 → 升序中位(索引 1)", () => {
    // finals [5, 3.5, 4.5] → 升序 3.5(i1),4.5(i2),5(i0) → 中位 i2
    expect(pickMedianCandidate([{ final: 5 }, { final: 3.5 }, { final: 4.5 }])).toBe(2);
  });

  test("n=3 含并列 → 稳定取中位", () => {
    // finals [5, 4, 5] → 升序 4(i1),5(i0),5(i2) → 中位 i0
    expect(pickMedianCandidate([{ final: 5 }, { final: 4 }, { final: 5 }])).toBe(0);
  });

  test("n=3 乱序输入", () => {
    // finals [4.5, 3.5, 4.0] → 升序 3.5(i1),4.0(i2),4.5(i0) → 中位 i2
    expect(pickMedianCandidate([{ final: 4.5 }, { final: 3.5 }, { final: 4.0 }])).toBe(2);
  });

  test("n=2 → 取较低者", () => {
    expect(pickMedianCandidate([{ final: 4 }, { final: 3 }])).toBe(1);
    expect(pickMedianCandidate([{ final: 3 }, { final: 5 }])).toBe(0);
  });

  test("n=1 → 用它", () => {
    expect(pickMedianCandidate([{ final: 4 }])).toBe(0);
  });

  test("空数组 / 非数组 → -1", () => {
    expect(pickMedianCandidate([])).toBe(-1);
    expect(pickMedianCandidate(undefined)).toBe(-1);
    expect(pickMedianCandidate(null)).toBe(-1);
  });
});

describe("recoverCompleteComparison", () => {
  test("keeps the median score report but replaces its truncated comparison", () => {
    const chosen = {
      final: 4.5,
      report: {
        score: 4.5,
        comparison: { modelEssay: "This essay was cut off", points: [] },
        sample: "This essay was cut off",
      },
    };
    const donor = {
      final: 5,
      report: {
        score: 5,
        comparison: {
          modelEssay: "This is the complete model essay.",
          points: [{ index: 1, title: "Content" }],
        },
      },
    };

    const recovered = recoverCompleteComparison(chosen, [chosen, donor]);

    expect(recovered.score).toBe(4.5);
    expect(recovered.comparison).toBe(donor.report.comparison);
    expect(recovered.sample).toBe("This is the complete model essay.");
    expect(recovered.comparisonRecovered).toBe(true);
  });
});

describe("evaluateWritingResponse: 三路取中位集成", () => {
  const text = makeWords(150);

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("选中中位候选,scoreSamples 按采样顺序,scoreSampleCount=有效候选数", async () => {
    callAIMulti.mockResolvedValue([rawWithScore(5), rawWithScore(3.5), rawWithScore(4.5)]);

    const report = await evaluateWritingResponse("email", {}, text, "zh");

    // 中位分 = 4.5(finals 3.5/4.5/5)
    expect(report.score).toBe(4.5);
    expect(report.scoreSamples).toEqual([5, 3.5, 4.5]);
    expect(report.scoreSampleCount).toBe(3);
    expect(report.reportLanguage).toBe("zh");
    expect(callAIMulti).toHaveBeenCalledWith("SYS", "USER", 8000, 175000, 0.3, 3);
  });

  test("parse 失败位置放 null,其余取低(n=2)", async () => {
    callAIMulti.mockResolvedValue(["not valid, no markers", rawWithScore(4), rawWithScore(3)]);

    const report = await evaluateWritingResponse("email", {}, text, "zh");

    // 有效候选 finals [4, 3] → 取低 3
    expect(report.score).toBe(3);
    expect(report.scoreSamples).toEqual([null, 4, 3]);
    expect(report.scoreSampleCount).toBe(2);
  });

  test("全部 parse 失败 → throw 第一份的 errorReason", async () => {
    callAIMulti.mockResolvedValue(["garbage", "more garbage", "still nothing"]);

    await expect(evaluateWritingResponse("email", {}, text, "zh")).rejects.toThrow(/section/i);
  });
});
