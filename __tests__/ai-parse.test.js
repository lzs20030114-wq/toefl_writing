import { parseReport } from "../lib/ai/parse";

describe("parseReport", () => {
  test("parses legacy JSON response", () => {
    const out = parseReport(
      JSON.stringify({
        score: 4,
        band: 4,
        summary: "ok",
        goals_met: [true, false, true],
      })
    );
    expect(out.error).toBeUndefined();
    expect(out.score).toBe(4);
    expect(out.band).toBe(4);
  });

  test("parses sectioned report with goals/annotation/patterns/action", () => {
    const raw = `
===SCORE===
分数: 4
Band: 4.0
总评: 三个目标基本完成，但语域偏口语。

===GOALS===
Goal1: OK 已解释提交问题
Goal2: PARTIAL 提到了重提请求但不具体
Goal3: MISSING 未说明成绩影响

===ANNOTATION===
Dear Professor,
<r>I am a subscriber of your magazine.</r><n level="red" fix="I am a subscriber to your magazine.">介词搭配错误。</n>
Thanks.

===PATTERNS===
{"patterns":[{"tag":"介词搭配","count":1,"summary":"固定搭配错误"},{"tag":"目标完成不充分","count":1,"summary":"第三目标缺失"}]}

===COMPARISON===
[范文]
Dear Professor, I would appreciate it if...

[对比]
1. 开头表达
   你的：I am a subscriber of your magazine.
   范文：I am a subscriber to your magazine.
   差异：固定搭配更准确。

===ACTION===
短板1: 介词搭配错误
重要性: 会直接影响语言准确性评分。
行动: 记忆并应用 subscribe to / apply for / depend on 三组搭配。
`;
    const out = parseReport(raw);
    expect(out.error).toBe(false);
    expect(out.score).toBe(4);
    expect(out.summary).toContain("语域");
    expect(out.goals).toHaveLength(3);
    expect(out.goals_met).toEqual([true, false, false]);
    expect(out.annotationCounts.red).toBe(1);
    expect(out.patterns[0].tag).toBe("介词搭配");
    expect(out.actions).toHaveLength(1);
    expect(out.next_steps[0]).toContain("subscribe to");
  });

  test("returns fallback when section markers are missing", () => {
    const out = parseReport("plain text");
    expect(out.error).toBe(true);
    expect(out.summary).toContain("评分解析失败");
  });
});
