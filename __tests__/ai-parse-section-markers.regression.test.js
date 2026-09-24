import fs from "fs";
import path from "path";

import { extractSections, parseReport, buildParseDiagnostics } from "../lib/ai/parse";

// 2026-09-21 线上故障：一份报告里批注与范文同时消失，分数照常显示、还不报错。
// 根因是段落标记的正则严格到只认 `===NAME===` 这一种写法 —— 模型给标记行加了
// 任何装饰（markdown 加粗 / 标题号 / 行尾空格 / 小写 / 缩进），那一段连同它后面
// 的内容就被并进上一段吞掉。批注、修订版（写后练习的唯一数据源）、范文、行动
// 建议是一起丢的。这组用例把每一种脏写法钉住。

const HEAD = `===SCORE===
分数: 3.0
Band: Intermediate
维度-任务完成: 3.0 目标基本完成
维度-组织连贯: 3.0 段落清楚
维度-语言使用: 3.0 小错较多
总评: 语域偏口语。
`;

const BODY = (marker) => `${HEAD}
${marker("ANNOTATION")}
<r>I hope that everything well</r><n level="red" fix="改为 I hope everything is well">系动词缺失</n>

${marker("CORRECTED")}
Dear Ms. Donovan, I hope everything is well.

${marker("PATTERNS")}
[{"tag":"拼写/基础语法","count":2,"summary":"avliable 等拼写错误"}]

${marker("COMPARISON")}
[范文]
Dear Ms. Donovan, I am writing to ask whether I may switch sections.

[对比]
1. 语域
   你的：So what I want to know is
   范文：I would like to ask whether
   差异：范文更正式。

${marker("ACTION")}
短板1: 语域偏口语
重要性: 直接影响任务完成分
行动: 用 I would like to ask whether 替换 So what I want to know is
`;

const DIRTY_MARKERS = {
  "行尾留空格": (n) => `===${n}=== `,
  "markdown 加粗": (n) => `**===${n}===**`,
  "前面带标题号": (n) => `## ===${n}===`,
  "小写段名": (n) => `===${n.toLowerCase()}===`,
  "行首缩进": (n) => `  ===${n}===`,
  "等号多写几个": (n) => `=====${n}=====`,
};

function expectFullReport(report) {
  expect(report.error).toBe(false);
  expect(report.score).toBe(3);
  expect(report.annotationCounts.red).toBe(1);
  expect(report.correctedText).toContain("Dear Ms. Donovan");
  expect(report.patterns).toHaveLength(1);
  expect(report.comparison.modelEssay).toContain("I am writing to ask");
  expect(report.comparison.points).toHaveLength(1);
  expect(report.actions).toHaveLength(1);
}

describe("段落标记解析", () => {
  test("干净的 ===NAME=== 照常解析", () => {
    expectFullReport(parseReport(BODY((n) => `===${n}===`)));
  });

  Object.entries(DIRTY_MARKERS).forEach(([label, marker]) => {
    test(`标记被装饰成「${label}」时，批注/修订版/范文/行动建议都不许丢`, () => {
      expectFullReport(parseReport(BODY(marker)));
    });
  });

  test("段名归一成大写，后续解析按大写段名取值", () => {
    const sections = extractSections("===score===\n分数: 4.0\n");
    expect(Object.keys(sections)).toEqual(["SCORE"]);
  });

  // 放宽是有边界的：考生正文里偶然写出 ===Something=== 不能被当成段头，
  // 否则原文会从那一行起被切走。
  test("白名单外的段名不当作段头", () => {
    const sections = extractSections(
      "===SCORE===\n分数: 4.0\n===TITLE===\nMy Essay\n===ANNOTATION===\nbody\n"
    );
    expect(Object.keys(sections).sort()).toEqual(["ANNOTATION", "SCORE"]);
    expect(sections.SCORE).toContain("===TITLE===");
    expect(sections.SCORE).toContain("My Essay");
  });

  // 白名单漏了新段名 = 那一段被静默吞掉。这里从 prompt 文件反查，
  // 谁新增了段落而忘了同步 KNOWN_SECTIONS，这条会红。
  test("prompt 里出现的每个段名都在白名单内", () => {
    const promptFiles = ["academicWriting.js", "emailWriting.js", "writingLesson.js"];
    const names = new Set();
    promptFiles.forEach((file) => {
      const src = fs.readFileSync(path.join(process.cwd(), "lib/ai/prompts", file), "utf8");
      (src.match(/^===[A-Z_]+===$/gm) || []).forEach((line) => names.add(line.replace(/=/g, "")));
    });
    expect(names.size).toBeGreaterThan(5);
    names.forEach((name) => {
      const sections = extractSections(`===${name}===\nbody\n`);
      expect(Object.keys(sections)).toEqual([name]);
    });
  });
});

describe("解析留痕 parseDiagnostics", () => {
  test("报告完整时不写诊断字段", () => {
    expect(parseReport(BODY((n) => `===${n}===`)).parseDiagnostics).toBeNull();
  });

  test("关键段缺失时留下标记原文与尾部片段", () => {
    const report = parseReport(HEAD);
    const diag = report.parseDiagnostics;
    expect(diag).not.toBeNull();
    expect(diag.sectionsMissing).toEqual(
      expect.arrayContaining(["ANNOTATION", "CORRECTED", "COMPARISON", "ACTION"])
    );
    expect(diag.markerLines).toContain("===SCORE===");
    expect(diag.rawTail).toContain("语域偏口语");
  });

  test("只缺一个段不算异常，不写诊断", () => {
    const sections = { ANNOTATION: "x", CORRECTED: "x", PATTERNS: "x", COMPARISON: "x" };
    expect(buildParseDiagnostics("raw", sections)).toBeNull();
  });
});
