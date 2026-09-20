// pickLessonInputs：发给 /api/ai/lesson 的报告摘要必须是白名单，不是整份 report。
// report 里的 annotationSegments / sections / sectionStates 又大又对讲评无用，
// 原样发过去会顶爆路由的 20000 字符上限，也会稀释模型注意力。
import { pickLessonInputs } from "../lib/ai/writingLesson";

const PLAIN = "The radiators is still cold and we has waited two weeks for a reply from the office.";

function makeReport(overrides = {}) {
  return {
    score: 3.5,
    band: "Intermediate+",
    summary: "总评一句话",
    rubric: {
      dimensions: {
        task_fulfillment: { score: 4, reason: "三个目标都提到", definition: "How fully..." },
        organization_coherence: { score: 3.5, reason: "衔接生硬" },
        language_use: { score: 3, reason: "主谓一致反复出错" },
      },
    },
    signals: { stance_clear: true, has_example: false, engages_discussion: true },
    goals: [{ index: 1, status: "ok", reason: "描述了问题" }],
    errorTriage: {
      capped: [{ quote: "the radiators is still cold", issue: "主谓一致", impedes: false, systemic: true }],
      minorSummary: "约 6 处拼写小错",
      verdict: "语言使用维度定为 3。",
    },
    patterns: [{ tag: "主谓一致", count: 3, summary: "重复出现" }],
    comparison: { modelEssay: "Dear Professor, ...", points: [{ index: 1, title: "t" }], raw: "巨大的原始文本" },
    annotationParsed: {
      plainText: PLAIN,
      annotations: [{ level: "red", message: "主谓一致", fix: "are", start: 4, end: 27 }],
    },
    // 下面这些都不该出现在摘要里
    annotationSegments: [{ type: "mark", text: "x".repeat(500) }],
    annotationRaw: "y".repeat(5000),
    sections: { ANNOTATION: "z".repeat(5000) },
    sectionStates: { SCORE: { ok: true, raw: "z".repeat(5000) } },
    correctedText: "corrected".repeat(200),
    ...overrides,
  };
}

describe("pickLessonInputs", () => {
  test("只保留白名单字段，大字段一个不带", () => {
    const out = pickLessonInputs(makeReport());
    expect(Object.keys(out).sort()).toEqual(
      ["annotations", "band", "errorTriage", "goals", "modelEssay", "patterns", "rubric", "score", "signals"].sort()
    );
    expect(out.annotationSegments).toBeUndefined();
    expect(out.annotationRaw).toBeUndefined();
    expect(out.sections).toBeUndefined();
    expect(out.sectionStates).toBeUndefined();
    expect(out.correctedText).toBeUndefined();
    expect(out.summary).toBeUndefined();
    // comparison 只取 modelEssay，raw / points 不带
    expect(out.modelEssay).toBe("Dear Professor, ...");
    expect(out.comparison).toBeUndefined();
  });

  test("rubric 只留 score + reason，内部英文 definition 不外发", () => {
    const out = pickLessonInputs(makeReport());
    expect(out.rubric.dimensions.task_fulfillment).toEqual({ score: 4, reason: "三个目标都提到" });
    expect(out.rubric.dimensions.language_use).toEqual({ score: 3, reason: "主谓一致反复出错" });
  });

  test("annotations 最多 25 条，且按 start/end 还原成原句片段", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      level: i % 2 ? "orange" : "red",
      message: `m${i}`,
      fix: `f${i}`,
      start: 0,
      end: 3,
    }));
    const out = pickLessonInputs(
      makeReport({ annotationParsed: { plainText: PLAIN, annotations: many } })
    );
    expect(out.annotations).toHaveLength(25);
    expect(out.annotations[0]).toEqual({ level: "red", text: "The", fix: "f0", message: "m0" });

    const single = pickLessonInputs(makeReport());
    expect(single.annotations[0].text).toBe("radiators is still cold");
  });

  test("errorTriage 只带 capped + minorSummary（verdict 是判分口径，讲评用不上）", () => {
    const out = pickLessonInputs(makeReport());
    expect(out.errorTriage.capped[0]).toEqual({
      quote: "the radiators is still cold",
      issue: "主谓一致",
      impedes: false,
      systemic: true,
    });
    expect(out.errorTriage.minorSummary).toBe("约 6 处拼写小错");
    expect(out.errorTriage.verdict).toBeUndefined();
  });

  test("goals 的 status 统一大写", () => {
    const out = pickLessonInputs(makeReport());
    expect(out.goals[0].status).toBe("OK");
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["空对象", {}],
    ["字符串", "boom"],
  ])("异常输入不抛错：%s", (_label, input) => {
    const out = pickLessonInputs(input);
    expect(out && typeof out === "object").toBe(true);
    expect(out.annotations).toBeUndefined();
  });

  test("序列化后远小于路由的 20000 字符上限", () => {
    const out = pickLessonInputs(makeReport());
    expect(JSON.stringify(out).length).toBeLessThan(20000);
  });
});
