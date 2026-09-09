/**
 * 真题落库的「源料体检扣留」判据（scripts/realbank/hold_policy.js）。
 *
 * 这道闸是产率与正确性的分界线：放宽一点就多收几百道题，放宽错了就把答案错位的卷
 * 整科上线。2026-09-08 人工核对第一来源 34 套后放宽了阅读科的两条判据，这里把
 * 「放宽到哪为止」锁死：
 *
 *   · ctw_answer_truncated 只挡该卷的 CTW，AP/RDL 照收（它们的答案不来自填词答案页，
 *     且逐题过了盲审）；
 *   · section_gap 按阅读盲审一致率条件放行（高一致率 = 答案页没错位，缺的题只是源里没有）；
 *   · ingest_blocker 里「无科目头的题号重启块被忽略」这一种，同样按阅读盲审一致率条件放行
 *     （被忽略的是答案页多出来的一段，配上的每题都过了盲审）；其它形态的 ingest_blocker 不变；
 *   · 其余 blocking code（audit_low_agreement / answer_key_misaligned / section_no_stems）
 *     以及写作/听力/口语三科，行为一律不变。
 *
 * 放宽判据 = 改这个测试之前先拿真题核对，不许为了让 build_bank 多收题而调松。
 */
const {
  SECTION_GAP_MIN_AGREEMENT,
  holdDecision,
  sectionAgreement,
} = require("../scripts/realbank/hold_policy.js");

const F = (code, sections = ["reading"], severity = "blocking") => ({
  code, severity, sections, detail: `${code} 测试用`,
});

describe("hold_policy.sectionAgreement", () => {
  test("只算指定科目的 agree 比例", () => {
    const audited = [
      { section: "reading", q: 1, agree: true },
      { section: "reading", q: 2, agree: false },
      { section: "listening", q: 1, agree: false },
    ];
    expect(sectionAgreement(audited, "reading")).toBe(0.5);
    expect(sectionAgreement(audited, "listening")).toBe(0);
  });

  test("没有明细 / 该科一题没审 → null（= 无从判断，后续按不放行处理）", () => {
    expect(sectionAgreement(null, "reading")).toBeNull();
    expect(sectionAgreement([], "reading")).toBeNull();
    expect(sectionAgreement([{ section: "writing", agree: true }], "reading")).toBeNull();
  });
});

describe("hold_policy.holdDecision：ctw_answer_truncated 只挡 CTW", () => {
  test("阅读不整科扣下，改为 dropCtw", () => {
    const d = holdDecision([F("ctw_answer_truncated")], "reading", { agreement: 0.94 });
    expect(d.held).toBe(false);
    expect(d.dropCtw).toBe(true);
    expect(d.notes.join("")).toMatch(/ctw_answer_truncated/);
  });

  test("与一致率无关：盲审再低也只影响逐题闸，不改变「只挡 CTW」这条", () => {
    // 一致率低的卷靠 build_bank 的逐题盲审闸自己丢题，不该在这里被误判成整科扣。
    expect(holdDecision([F("ctw_answer_truncated")], "reading", { agreement: 0.4 }).held).toBe(false);
    expect(holdDecision([F("ctw_answer_truncated")], "reading", {}).held).toBe(false);
  });

  test("同卷若另有真 blocking，整科仍扣下，且不再谈 dropCtw", () => {
    const d = holdDecision(
      [F("ctw_answer_truncated"), F("ingest_blocker", ["*"])], "reading", { agreement: 1 });
    expect(d.held).toBe(true);
    expect(d.heldBy).toContain("ingest_blocker");
    expect(d.dropCtw).toBe(false);
  });
});

describe("hold_policy.holdDecision：section_gap 按盲审一致率条件放行", () => {
  test("一致率 0.9 → 放行并记账", () => {
    const d = holdDecision([F("section_gap")], "reading", { agreement: 0.9 });
    expect(d.held).toBe(false);
    expect(d.notes.join("")).toMatch(/section_gap/);
  });

  test("一致率 0.6 → 仍整科扣下", () => {
    const d = holdDecision([F("section_gap")], "reading", { agreement: 0.6 });
    expect(d.held).toBe(true);
    expect(d.heldBy).toEqual(["section_gap"]);
  });

  test("拿不到一致率（没跑盲审）→ 保守扣下，不放行", () => {
    expect(holdDecision([F("section_gap")], "reading", { agreement: null }).held).toBe(true);
    expect(holdDecision([F("section_gap")], "reading", {}).held).toBe(true);
  });

  test("阈值就在 0.85，边界取「≥ 放行」", () => {
    expect(SECTION_GAP_MIN_AGREEMENT).toBe(0.85);
    expect(holdDecision([F("section_gap")], "reading", { agreement: 0.85 }).held).toBe(false);
    expect(holdDecision([F("section_gap")], "reading", { agreement: 0.8499 }).held).toBe(true);
  });
});

describe("hold_policy.holdDecision：ingest_blocker「题号重启块」按盲审一致率条件放行", () => {
  // 真实 detail 形状（source-flags.json 里 2.8 / 3.24 / 3.29 / 4.18 四卷）：
  const RESTART = (subject = "reading") => ({
    code: "ingest_blocker",
    severity: "blocking",
    sections: ["*"],
    detail: `[3.29 答案.pdf] 答案页第 9 行出现无科目头的题号重启块（当前科目 ${subject}），`
      + "已忽略(fail-closed)：1d 2b 3c 4d 5d 6c 7b 8b 9d 10a",
  });

  test("阅读盲审一致率 0.94 → 放行并记账（被忽略的只是多出来的答案块）", () => {
    const d = holdDecision([RESTART()], "reading", { agreement: 0.94 });
    expect(d.held).toBe(false);
    expect(d.heldBy).toEqual([]);
    expect(d.notes.join("")).toMatch(/ingest_blocker/);
  });

  test("阅读盲审一致率 0.6 / 没跑盲审 → 仍整科扣下", () => {
    expect(holdDecision([RESTART()], "reading", { agreement: 0.6 }).held).toBe(true);
    expect(holdDecision([RESTART()], "reading", {}).held).toBe(true);
  });

  test("detail 不是「题号重启块」那一种 → 一致率再高也整科扣下", () => {
    const other = {
      code: "ingest_blocker", severity: "blocking", sections: ["*"],
      detail: "[x.pdf] 答案页整段读不出，已忽略(fail-closed)",
    };
    expect(holdDecision([other], "reading", { agreement: 1 }).held).toBe(true);
  });

  test("只放宽阅读科：同一条 flag 对听力/写作/口语照旧整科扣下", () => {
    // 4.18 那条 detail 写的是「当前科目 listening」，但放宽与 detail 里的科目无关，
    // 只看当前在判哪一科 —— 听力仍旧扣下。
    for (const sec of ["listening", "writing", "speaking"]) {
      expect(holdDecision([RESTART("listening")], sec, { agreement: 1 }).held).toBe(true);
    }
  });
});

describe("hold_policy.holdDecision：其余判据行为不变", () => {
  test("audit_low_agreement 仍整科扣下（一致率再怎么样都不放行）", () => {
    expect(holdDecision([F("audit_low_agreement")], "reading", { agreement: 1 }).held).toBe(true);
    expect(holdDecision([F("answer_key_misaligned")], "reading", { agreement: 1 }).held).toBe(true);
    expect(holdDecision([F("section_no_stems")], "reading", {}).held).toBe(true);
    // detail 里没有「题号重启块」→ 不属于放宽的那一种形态，照旧整科扣下。
    expect(holdDecision([F("ingest_blocker", ["*"])], "reading", { agreement: 1 }).held).toBe(true);
  });

  test("warn 级 flag 从不扣留", () => {
    const d = holdDecision([F("vendor_pool", ["*"], "warn"), F("section_gap", ["reading"], "warn")],
      "reading", {});
    expect(d).toEqual({ held: false, heldBy: [], dropCtw: false, notes: [] });
  });

  test("放宽只在阅读科生效：写作的 section_gap(blocking) 照旧整科扣下", () => {
    expect(holdDecision([F("section_gap", ["writing"])], "writing", { agreement: 1 }).held).toBe(true);
    expect(holdDecision([F("ctw_answer_truncated", ["*"])], "listening", { agreement: 1 }).held).toBe(true);
  });

  test("其它科目的 flag 不影响本科", () => {
    expect(holdDecision([F("section_no_stems", ["writing"])], "reading", {}).held).toBe(false);
  });
});

/**
 * 后台复核放行清单（契约 §4，data/realBank/review-overrides.json）。
 *
 * 语义：人在后台点过「放行」的 (卷, 科, code) 就当这条 blocking 不存在。它比任何自动
 * 判据都权威 —— 自动判据是「没人看过时怎么办」，override 是「人看过了」。
 * 但清单**缺失**时必须 fail 到「照旧扣留」那一侧：读不到文件绝不等于全部放行。
 */
describe("hold_policy 复核放行清单（review-overrides）", () => {
  const { allowSays, loadOverrides, clearOverridesCache } = require("../scripts/realbank/hold_policy.js");
  const A = (set, section, code) => ({ set, section, code, reason: "人工核过", by: "admin" });

  test("命中 (set, section, code) → 不再扣留，并留下记账 note", () => {
    const d = holdDecision([F("section_no_stems")], "reading",
      { set: "9.12新托福真题", allow: [A("9.12新托福真题", "reading", "section_no_stems")] });
    expect(d.held).toBe(false);
    expect(d.notes.join()).toMatch(/后台复核已放行/);
  });

  test('code:"*" 放行该科全部 blocking', () => {
    const d = holdDecision([F("section_no_stems"), F("answer_key_misaligned")], "reading",
      { set: "S", allow: [A("S", "reading", "*")] });
    expect(d.held).toBe(false);
  });

  test('section:"*" 跨科放行', () => {
    expect(holdDecision([F("section_gap", ["writing"])], "writing",
      { set: "S", allow: [A("S", "*", "section_gap")] }).held).toBe(false);
  });

  test("卷名/科目/code 任一对不上就不放行", () => {
    const flags = [F("section_no_stems")];
    expect(holdDecision(flags, "reading", { set: "S", allow: [A("别的卷", "reading", "section_no_stems")] }).held).toBe(true);
    expect(holdDecision(flags, "reading", { set: "S", allow: [A("S", "listening", "section_no_stems")] }).held).toBe(true);
    expect(holdDecision(flags, "reading", { set: "S", allow: [A("S", "reading", "别的code")] }).held).toBe(true);
  });

  test("没给 set（老调用方）→ 一律不放行，行为与改动前相同", () => {
    expect(holdDecision([F("section_no_stems")], "reading",
      { allow: [A("S", "reading", "section_no_stems")] }).held).toBe(true);
  });

  test("清单空/缺失 → 照旧扣留（fail 到安全那一侧）", () => {
    expect(holdDecision([F("section_no_stems")], "reading", { set: "S", allow: [] }).held).toBe(true);
    expect(allowSays(undefined, "S", "reading", "x")).toBe(false);
    expect(allowSays([A("S", "reading", "x")], "", "reading", "x")).toBe(false);
  });

  test("loadOverrides 读不到文件时返回空清单而不是抛异常", () => {
    clearOverridesCache();
    expect(loadOverrides("/definitely/not/a/repo")).toEqual({ allow: [] });
    clearOverridesCache();
  });
});
