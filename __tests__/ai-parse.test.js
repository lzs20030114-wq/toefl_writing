import { parseErrorsSection, parseReport, parseScoreReport } from "../lib/ai/parse";

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

  // 反兜底回归：旧实现在任一字段不含中文时把整段换成三句万能文案
  // （「语言与任务表达可提升」…），模型真写的建议被塞进「（原建议：…）」。
  // 现在原样保留，只用 langOk 记一笔供日后度量。
  test("keeps English ACTION text verbatim and flags langOk=false", () => {
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
    expect(out.actions[0].title).toBe("Improve transitions");
    expect(out.actions[0].importance).toBe("Weak transitions reduce coherence.");
    expect(out.actions[0].action).toBe("Use linking words like however, therefore, and for example.");
    expect(out.actions[0].langOk).toBe(false);
    expect(JSON.stringify(out.actions)).not.toContain("原建议");
    expect(JSON.stringify(out.actions)).not.toContain("语言与任务表达可提升");
  });

  test("Chinese ACTION text sets langOk=true", () => {
    const raw = `
===SCORE===
分数: 3
Band: 3.5
总评: clear
===ACTION===
短板1: 介词搭配
重要性: 影响语言准确度评分。
行动: 背诵并使用 subscribe to / apply for。
`;
    const out = parseReport(raw);
    expect(out.actions[0].langOk).toBe(true);
    expect(out.actions[0].title).toBe("介词搭配");
  });

  test("mixed-language ACTION (English action line) is kept and marked langOk=false", () => {
    const raw = `
===SCORE===
分数: 3
Band: 3.5
总评: clear
===ACTION===
短板1: 论证展开不足
重要性: 支撑薄弱会降低说服力。
行动: Add one concrete example per paragraph.
`;
    const out = parseReport(raw);
    expect(out.actions[0].action).toBe("Add one concrete example per paragraph.");
    expect(out.actions[0].langOk).toBe(false);
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
    expect(out.errorTriage).toBeNull();
  });
});

describe("parseScoreSection dimension reasons", () => {
  const withScore = (dimLines) => `
===SCORE===
分数: 4.5
Band: High-Intermediate+
${dimLines}
总评: 语言小错偏多。
`;

  test("captures the one-line reason written after each dimension score", () => {
    const out = parseReport(
      withScore(
        [
          "维度-任务完成: 5 三个目标均完成且有细节",
          "维度-组织连贯: 4.5 结构清晰衔接自然",
          "维度-语言使用: 3.5 局部小错较多但均不影响理解",
        ].join("\n")
      )
    );
    expect(out.error).toBe(false);
    const d = out.rubric.dimensions;
    expect(d.task_fulfillment.score).toBe(5);
    expect(d.task_fulfillment.reason).toBe("三个目标均完成且有细节");
    expect(d.organization_coherence.score).toBe(4.5);
    expect(d.organization_coherence.reason).toBe("结构清晰衔接自然");
    expect(d.language_use.score).toBe(3.5);
    expect(d.language_use.reason).toBe("局部小错较多但均不影响理解");
  });

  test("dimension without a reason keeps the score and an empty reason", () => {
    const out = parseReport(withScore("维度-任务完成: 4"));
    expect(out.rubric.dimensions.task_fulfillment.score).toBe(4);
    expect(out.rubric.dimensions.task_fulfillment.reason).toBe("");
    // 未写的维度仍为 null,交给 calibration 回落到 holistic 分(写 0 会改分)
    expect(out.rubric.dimensions.language_use.score).toBeNull();
    expect(out.rubric.dimensions.language_use.reason).toBe("");
  });

  test("strips a leading separator between the score and its reason", () => {
    const out = parseReport(withScore("维度-组织连贯：4.5 —— 段落推进清楚"));
    expect(out.rubric.dimensions.organization_coherence.score).toBe(4.5);
    expect(out.rubric.dimensions.organization_coherence.reason).toBe("段落推进清楚");
  });

  test("no dimension lines at all still yields rubric = null", () => {
    const out = parseReport(`
===SCORE===
分数: 3
Band: Intermediate
总评: clear
`);
    expect(out.rubric).toBeNull();
  });
});

describe("parseErrorsSection (===ERRORS=== triage)", () => {
  const ERRORS_BLOCK = `② 类·压分（系统性语法失控或妨碍理解；同类合并，最多列 6 条，无则写「无」）:
- the radiators is still cold → 主谓一致反复出错（是否妨碍理解: 否；是否系统性失控: 是）
- I have trouble to concentrate → 动词搭配错误（是否妨碍理解: 是；是否系统性失控: 否）
① 类·不压分（限时小错，一句话概述，不逐条罗列）: 约 6-8 处拼写/代词/搭配小错，均不妨碍理解、非系统性失控
判定: ② 类中妨碍理解 1 处、体现系统性失控 是 → 语言使用维度定为 3.5。`;

  const wrap = (errors) => `
===ERRORS===
${errors}

===SCORE===
分数: 3.5
Band: Intermediate+
维度-语言使用: 3.5 系统性主谓一致失控
总评: 语言层面有系统性失控。
`;

  test("parses capped items, minor summary and verdict", () => {
    const out = parseReport(wrap(ERRORS_BLOCK));
    expect(out.error).toBe(false);
    const t = out.errorTriage;
    expect(t.capped).toHaveLength(2);
    expect(t.capped[0]).toEqual({
      quote: "the radiators is still cold",
      issue: "主谓一致反复出错",
      impedes: false,
      systemic: true,
    });
    expect(t.capped[1].impedes).toBe(true);
    expect(t.capped[1].systemic).toBe(false);
    expect(t.minorSummary).toBe("约 6-8 处拼写/代词/搭配小错，均不妨碍理解、非系统性失控");
    expect(t.verdict).toContain("语言使用维度定为 3.5");
    expect(out.sectionStates.ERRORS.ok).toBe(true);
  });

  test("accepts ASCII colons, ASCII arrows and half-width parentheses", () => {
    const out = parseReport(
      wrap(`压分:
- He go to school everyday -> 主谓一致(是否妨碍理解: 否;是否系统性失控: 是)
不压分: 约 3 处拼写小错
判定: 语言使用维度定为 4.0`)
    );
    const t = out.errorTriage;
    expect(t.capped).toHaveLength(1);
    expect(t.capped[0].quote).toBe("He go to school everyday");
    expect(t.capped[0].issue).toBe("主谓一致");
    expect(t.capped[0].systemic).toBe(true);
    expect(t.minorSummary).toBe("约 3 处拼写小错");
    expect(t.verdict).toBe("语言使用维度定为 4.0");
  });

  test("「无」on both classes yields an empty capped list and keeps 无 as the minor summary", () => {
    const out = parseReport(
      wrap(`② 类·压分（系统性语法失控或妨碍理解）: 无
① 类·不压分（限时小错）: 无
判定: ② 类中妨碍理解 0 处、体现系统性失控 否 → 语言使用维度定为 5.0。`)
    );
    const t = out.errorTriage;
    expect(t.capped).toEqual([]);
    expect(t.minorSummary).toBe("无");
    expect(t.verdict).toContain("语言使用维度定为 5.0");
    expect(out.sectionStates.ERRORS.ok).toBe(true);
  });

  test("a bare 「- 无」bullet is not turned into a capped item", () => {
    const out = parseReport(
      wrap(`② 类·压分（…）:
- 无
① 类·不压分（…）: 无`)
    );
    expect(out.errorTriage.capped).toEqual([]);
  });

  test("missing ERRORS section leaves errorTriage null and the section state ok", () => {
    const out = parseReport(`
===SCORE===
分数: 4
Band: High-Intermediate
总评: clear
`);
    expect(out.errorTriage).toBeNull();
    expect(out.sectionStates.ERRORS.ok).toBe(true);
    expect(out.sectionStates.ERRORS.raw).toBe("");
  });

  test("unparseable ERRORS body never throws and never breaks the score", () => {
    const out = parseReport(wrap("完全不符合格式的一段自由文字"));
    expect(out.error).toBe(false);
    expect(out.score).toBe(3.5);
    expect(out.errorTriage).toEqual({ capped: [], minorSummary: "", verdict: "" });
    expect(out.sectionStates.ERRORS.ok).toBe(false);
  });

  test("standalone parseErrorsSection tolerates null / empty input", () => {
    expect(parseErrorsSection(null)).toEqual({ capped: [], minorSummary: "", verdict: "" });
    expect(parseErrorsSection("")).toEqual({ capped: [], minorSummary: "", verdict: "" });
    expect(parseErrorsSection("   ")).toEqual({ capped: [], minorSummary: "", verdict: "" });
  });
});

