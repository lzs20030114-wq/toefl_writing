import { parseReport, parseScoreReport } from "../lib/ai/parse";

describe("parseReport", () => {
  test("parses JSON response", () => {
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

  test("accepts numeric strings in JSON score fields", () => {
    const out = parseReport(
      JSON.stringify({
        score: "4.5",
        band: "5.0",
        summary: "ok",
      })
    );
    expect(out.error).toBeUndefined();
    expect(out.score).toBe(4.5);
    expect(out.band).toBe(5);
  });

  test("parses sectioned report in new format", () => {
    const raw = `
===SCORE===
分数: 4
Band: 4.5
总评: 三个目标基本完成，但语域偏口语化。
===GOALS===
Goal1: OK 已说明写信目的
Goal2: PARTIAL 请求细节不够具体
Goal3: MISSING 未提到截止时间影响
===ANNOTATION===
Dear Professor,
<r>I am a subscriber of your magazine.</r><n level="red" fix="I am a subscriber to your magazine.">介词搭配错误。</n>
Thanks.

===PATTERNS===
[{"tag":"介词搭配","count":1,"summary":"固定搭配错误"},{"tag":"礼貌用语缺失","count":1,"summary":"缺少正式礼貌句型"}]

===COMPARISON===
[范文]
Dear Professor, I would appreciate it if...

[对比]
1. 开头表达
   你的: I am a subscriber of your magazine.
   范文: I am a subscriber to your magazine.
   差异: 固定搭配更准确。
===ACTION===
短板1: 介词搭配
重要性: 影响语言准确度评分。
行动: 背诵并使用 subscribe to / apply for / depend on。
`;

    const out = parseReport(raw);
    expect(out.error).toBe(false);
    expect(out.score).toBe(4);
    expect(out.summary).toContain("语域偏口语化");
    expect(out.goals).toHaveLength(3);
    expect(out.goals_met).toEqual([true, false, false]);
    expect(out.annotationCounts.red).toBe(1);
    expect(out.patterns[0].tag).toBe("介词搭配");
    expect(out.actions).toHaveLength(1);
    expect(out.next_steps[0]).toContain("subscribe to");
    expect(out.sectionStates.PATTERNS.ok).toBe(true);
  });

  test("parseScoreReport returns board-friendly shape", () => {
    const raw = `
===SCORE===
分数: 3
Band: 3.5
总评: 论证展开有限。
===ACTION===
短板1: 增加支撑
重要性: 支撑薄弱会降低说服力。
行动: 使用 for example 增加具体细节。
`;
    const out = parseScoreReport(raw, "discussion");
    expect(out.score).toBe(3);
    expect(out.actions).toHaveLength(1);
    expect(out.goals).toBeNull();
  });

  test("parses SCORE section with full-width colon", () => {
    const raw = `
===SCORE===
分数：4.5
Band：5.0
总评：Response is clear and focused.
`;
    const out = parseReport(raw);
    expect(out.error).toBe(false);
    expect(out.score).toBe(4.5);
    expect(out.band).toBe(5);
    expect(out.summary).toContain("clear and focused");
  });

  test("accepts score in decimal format like 4.0", () => {
    const raw = `
===SCORE===
分数: 4.0
Band: 4.5
总评: clear
`;
    const out = parseReport(raw);
    expect(out.error).toBe(false);
    expect(out.score).toBe(4);
  });

  test("treats empty pattern array as successfully parsed section", () => {
    const raw = `
===SCORE===
分数: 3
Band: 3.5
总评: clear
===PATTERNS===
[]
`;
    const out = parseReport(raw);
    expect(out.error).toBe(false);
    expect(out.sectionStates.PATTERNS.ok).toBe(true);
  });

  test("annotation section stays available when parse error has recovered marks", () => {
    const raw = `
===SCORE===
分数: 3
Band: 3.5
总评: clear
===ANNOTATION===
<r>He go school.</r><n level="red" fix="He goes to school.">语法错误。</n>
<r>broken<n level="red" fix="x">y
`;
    const out = parseReport(raw);
    expect(out.error).toBe(false);
    expect(out.annotationCounts.red).toBeGreaterThan(0);
    expect(out.sectionStates.ANNOTATION.ok).toBe(true);
  });

  test("normalizes ACTION suggestions to Chinese when AI returns English", () => {
    const raw = `
===SCORE===
分数: 3
Band: 3.5
总评: clear
===ACTION===
Action1: Improve transitions
Importance: Weak transitions reduce coherence.
Action: Use linking words like however, therefore, and for example.
`;
    const out = parseReport(raw);
    expect(out.error).toBe(false);
    expect(out.actions).toHaveLength(1);
    expect(/[\u4e00-\u9fff]/.test(out.actions[0].title)).toBe(true);
    expect(/[\u4e00-\u9fff]/.test(out.actions[0].importance)).toBe(true);
    expect(/[\u4e00-\u9fff]/.test(out.actions[0].action)).toBe(true);
  });

  test("parses inline <n> annotation format and keeps counts non-zero", () => {
    const raw = `
===SCORE===
分数: 4
Band: 4.0
总评: Mostly clear.
===ANNOTATION===
Dear Professor, <n level="red" fix="I have received your feedback.">I receive your feedback.</n>
Thanks for your time.
`;
    const out = parseReport(raw);
    expect(out.error).toBe(false);
    expect(out.annotationCounts.red).toBeGreaterThan(0);
    expect(out.annotationParsed.plainText).not.toContain("<n");
    expect(out.annotationSegments.some((s) => s.type === "mark")).toBe(true);
  });

  test("returns fallback when section markers are missing", () => {
    const out = parseReport("plain text");
    expect(out.error).toBe(true);
    expect(out.summary).toContain("Scoring parse failed");
  });
});

