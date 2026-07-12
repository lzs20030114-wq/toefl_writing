import { parseReport } from "../lib/ai/parse";
import { calibrateScoreReport } from "../lib/ai/calibration";

// Guards the 2026-07-12 scoring-anchor rework: the judging prompt now emits a
// new ===ERRORS=== section (timed-slip vs ability-defect classification) BEFORE
// ===SCORE===, and email GOALS lines carry an inline 佐证原句:"..." citation.
// parse.js must ignore the unknown ERRORS section and still parse score/goals —
// if a future parse.js edit breaks this forward-compat, scoring silently 0's out.
describe("scoring parse — ===ERRORS=== / GOALS-citation forward compat", () => {
  const NEW_FORMAT_EMAIL = `===ERRORS===
限时手滑（① 类，不压分）:
- teh → the（类型: 拼写）
能力缺陷（② 类，压语言维度分）:
- the radiators is cold → 主谓一致（类型: 主谓一致；是否妨碍理解: 否）
判定: 本文 ② 类能力缺陷 1 处 → 语言使用维度定为 4.0；① 类手滑不计入扣分。

===SCORE===
分数: 3.0
Band: Intermediate
维度-任务完成: 3.0 目标三缺失
维度-组织连贯: 4.0 结构清楚
维度-语言使用: 4.0 除手滑外几无能力缺陷
总评: 第三个目标未提出任何具体建议。

===GOALS===
Goal1: OK 佐证原句:"the heater has completely stop working" | 描述了问题
Goal2: OK 佐证原句:"I have trouble to concentrate" | 说明了影响
Goal3: MISSING 佐证原句:"（原文无对应内容）" | 全文没有提出改动建议

===ANNOTATION===
The heater <r>is cold</r><n level="red" fix="改为 are cold">主谓一致错误</n>.

===CORRECTED===
The heater is not working.

===PATTERNS===
[{"tag":"目标完成不充分","count":1,"summary":"missing suggestion: 'no suggestion sentence'"}]

===COMPARISON===
[范文]
Dear Ms. X, ...
[对比]
1. 目标完成
   你的：missing
   范文：full
   差异：范文提出了具体建议

===ACTION===
短板1: 第三目标缺失
重要性: 触发漏答封顶
行动: 补一句 "Could you consider extending the hours?"
对应原句: （原文无对应内容）`;

  test("ignores the unknown ===ERRORS=== section without erroring", () => {
    const r = parseReport(NEW_FORMAT_EMAIL);
    expect(r.error).toBe(false);
    // ERRORS is captured as a raw section but never consumed as a scoring field.
    expect(r.sections.ERRORS).toBeTruthy();
  });

  test("still parses score, dimensions and summary with ERRORS placed first", () => {
    const r = parseReport(NEW_FORMAT_EMAIL);
    expect(r.score).toBe(3);
    expect(r.rubric.dimensions.language_use.score).toBe(4);
    expect(r.summary).toContain("第三个目标");
  });

  test("parses GOALS lines that carry an inline 佐证原句 citation", () => {
    const r = parseReport(NEW_FORMAT_EMAIL);
    expect(r.goals).toHaveLength(3);
    expect(r.goals[0].status).toBe("OK");
    expect(r.goals[2].status).toBe("MISSING");
    // the citation text survives in the reason field (не dropped)
    expect(r.goals[0].reason).toContain("佐证原句");
  });

  test("a MISSING goal still drives the email ≤3 calibration cap", () => {
    const r = parseReport(NEW_FORMAT_EMAIL);
    const cal = calibrateScoreReport("email", r, "x ".repeat(120));
    expect(cal.score).toBeLessThanOrEqual(3);
    expect(cal.calibration.reasons).toContain("email_goal_missing_cap");
  });
});
