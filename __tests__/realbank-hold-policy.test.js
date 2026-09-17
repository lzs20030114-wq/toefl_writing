/**
 * 真题落库的「源料体检扣留」判据（scripts/realbank/hold_policy.js）。
 *
 * 这道闸是产率与正确性的分界线：放宽一点就多收几百道题，放宽错了就把答案错位的卷
 * 整科上线。2026-09-08 人工核对第一来源 34 套后放宽了阅读科的两条判据，这里把
 * 「放宽到哪为止」锁死：
 *
 *   · ctw_answer_truncated 不整科扣，CTW 也不再整卷拒收（答案页是后半截写法，逐空由
 *     ctw_verify.js 还原校验）；AP/RDL 照收（逐题过了盲审）；
 *   · 盲审闸 auditPassed：第一票一致即过；第一票不一致时只有显式跑过且一致的第二票能放行；
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
  auditPassed,
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

describe("hold_policy.holdDecision：ctw_answer_truncated 不扣科、不整卷拒收 CTW", () => {
  test("阅读不整科扣下，CTW 也不整卷拒收（逐空后半截还原校验在 ctw_verify.js）", () => {
    const d = holdDecision([F("ctw_answer_truncated")], "reading", { agreement: 0.94 });
    expect(d.held).toBe(false);
    expect(d.dropCtw).toBe(false);
    expect(d.notes.join("")).toMatch(/ctw_answer_truncated/);
  });

  test("与一致率无关：盲审再低也只影响逐题闸，不改变「不扣科」这条", () => {
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

  test("阅读只有填词（选择题一道没配上答案，4.29 形态）→ 没有一致率也放行，只放得进核过答案页的填词", () => {
    const d = holdDecision([F("section_gap")], "reading", { agreement: null, ctwOnly: true });
    expect(d.held).toBe(false);
    expect(d.notes.join("")).toMatch(/只剩填词/);
    // 有选择题、只是没跑盲审 → 仍按老规矩扣下
    expect(holdDecision([F("section_gap")], "reading", { agreement: null, ctwOnly: false }).held).toBe(true);
    // 有一致率且太低：ctwOnly 不当免死金牌（那是真错位的信号）
    expect(holdDecision([F("section_gap")], "reading", { agreement: 0.5, ctwOnly: true }).held).toBe(true);
    // 只放宽 section_gap：同卷另有真 blocking 照扣
    expect(holdDecision([F("section_gap"), F("answer_key_misaligned")], "reading", { agreement: null, ctwOnly: true }).held).toBe(true);
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

describe("hold_policy.auditPassed：第二票只对显式跑过的题生效", () => {
  test("第一票一致即过", () => {
    expect(auditPassed({ section: "reading", q: 1, agree: true })).toBe(true);
  });

  test("第一票不一致 / 没作答且没有第二票 → 不过（与引入第二票之前一致）", () => {
    expect(auditPassed({ agree: false, model: "A", stamped: "B" })).toBe(false);
    expect(auditPassed({ agree: false, model: null, stamped: "B" })).toBe(false);
  });

  test("第一票不一致、第二票与答案页一致 → 过", () => {
    expect(auditPassed({ agree: false, second_vote: { model: "deepseek-v4-pro", pick: "B", agree: true } })).toBe(true);
  });

  test("第二票也不一致 / 没作答 → 不过", () => {
    expect(auditPassed({ agree: false, second_vote: { pick: "A", agree: false } })).toBe(false);
    expect(auditPassed({ agree: false, second_vote: { pick: null, agree: false } })).toBe(false);
  });

  test("sectionAgreement 仍只数第一票（条件放行口径不因第二票抬高）", () => {
    const audited = [
      { section: "reading", agree: true },
      { section: "reading", agree: false, second_vote: { agree: true } },
    ];
    expect(sectionAgreement(audited, "reading")).toBe(0.5);
  });

  test("空值不炸", () => {
    expect(auditPassed(null)).toBe(false);
    expect(auditPassed(undefined)).toBe(false);
  });
});

/**
 * 人工核定放行（data/realBank/audit-overrides.json）：盲审两票都与答案页不同、人对着原卷截图核过「答案页对」的题。
 * 口子收得很紧 —— 卷 / 科 / 题号 / 答案页字母 / 题干前缀任何一个对不上都不放行。
 */
describe("hold_policy.manualAuditPass", () => {
  const { manualAuditPass } = require("../scripts/realbank/hold_policy.js");
  const E = {
    set: "3.30新托福真题", section: "reading", q: 32, stamped: "A", verdict: "key_correct",
    stem: "According to the passage, corn plants", reason: "原卷截图第 2 段：……答案页 A 成立，D 与原文相反",
  };
  const AT = { set: "3.30新托福真题", section: "reading", q: 32, stamped: "a", stem: "According to the passage, corn plants may release MBOA" };

  test("逐项对上（答案页字母大小写不敏感）→ 放行", () => {
    expect(manualAuditPass([E], AT)).toBe(true);
  });

  test("答案页字母变了 / 题干换了 / 题号或卷名不同 → 不放行（旧核定自动失效）", () => {
    expect(manualAuditPass([E], { ...AT, stamped: "B" })).toBe(false);
    expect(manualAuditPass([E], { ...AT, stem: "Which of the following is NOT mentioned" })).toBe(false);
    expect(manualAuditPass([E], { ...AT, q: 33 })).toBe(false);
    expect(manualAuditPass([E], { ...AT, set: "4.18新托福真题" })).toBe(false);
  });

  test("清单条目不合格（不是 key_correct / 没写核对依据 / 题干前缀太短）→ 不放行", () => {
    expect(manualAuditPass([{ ...E, verdict: "key_wrong" }], AT)).toBe(false);
    expect(manualAuditPass([{ ...E, reason: "" }], AT)).toBe(false);
    expect(manualAuditPass([{ ...E, stem: "According" }], AT)).toBe(false);
    expect(manualAuditPass([], AT)).toBe(false);
    expect(manualAuditPass(undefined, AT)).toBe(false);
  });
});

/**
 * 人工核定「答案页印错」（audit-overrides.json 的 verdict=key_corrected）：推翻官方答案键要三方互证 ——
 * 两票盲审都选中核定的字母 + 人对着原卷截图核过（清单写依据）。缺一不改。
 */
describe("hold_policy.manualAnswerFix", () => {
  const { manualAnswerFix } = require("../scripts/realbank/hold_policy.js");
  const E = {
    set: "4.20新托福真题", section: "reading", q: 13, stamped: "C", corrected: "B", verdict: "key_corrected",
    stem: "The word \"fundamentally\" in the passage", reason: "原卷截图：…fundamentally reshaped the visual and emotional stage landscape → thoroughly",
  };
  const AT = { set: "4.20新托福真题", section: "reading", q: 13, stamped: "c", stem: "The word \"fundamentally\" in the passage is closest in meaning to", votes: ["B", "b"] };

  test("逐项对上、两票都选核定字母 → 返回核定字母", () => {
    expect(manualAnswerFix([E], AT)).toBe("B");
  });

  test("两票里有一票不同 / 只跑了一票 → 不改", () => {
    expect(manualAnswerFix([E], { ...AT, votes: ["B", "D"] })).toBeNull();
    expect(manualAnswerFix([E], { ...AT, votes: ["B", undefined] })).toBeNull();
    expect(manualAnswerFix([E], { ...AT, votes: ["B"] })).toBeNull();
  });

  test("答案页字母变了 / 题干换了 / 核定字母非法或与答案页相同 / 不是 key_corrected → 不改", () => {
    expect(manualAnswerFix([E], { ...AT, stamped: "A" })).toBeNull();
    expect(manualAnswerFix([E], { ...AT, stem: "What is the main purpose of the passage?" })).toBeNull();
    expect(manualAnswerFix([{ ...E, corrected: "E" }], AT)).toBeNull();
    expect(manualAnswerFix([{ ...E, corrected: "C" }], { ...AT, votes: ["C", "C"] })).toBeNull();
    expect(manualAnswerFix([{ ...E, verdict: "key_correct" }], AT)).toBeNull();
    expect(manualAnswerFix([{ ...E, reason: " " }], AT)).toBeNull();
  });
});

/**
 * 人工核定的 module 定位（2026-09-17 扩到听力时加）。
 *
 * 听力 M1/M2 的题号都从 1 起编，光凭 `q` 指不到具体是哪一道 —— 盲审闸就是这么误放行过 20 题的
 * （病根与修法见 scripts/realbank/audit_key.js）。人工核定比盲审闸更该收紧，所以听力条目**必须**写 module；
 * 阅读的 5 条历史条目没写 module，沿用老行为（它们逐条对过原卷、已经在库里生效，不动）。
 */
describe("hold_policy 人工核定的 module 定位", () => {
  const { manualAnswerFix, manualAuditPass } = require("../scripts/realbank/hold_policy.js");
  const L = {
    set: "4.6新托福真题", section: "listening", module: 2, q: 8, stamped: "B", corrected: "C", verdict: "key_corrected",
    stem: "What does the speaker mainly discuss?", reason: "转写：Kahlo's drawings, however, are rather obscure → C",
  };
  const AT = {
    set: "4.6新托福真题", section: "listening", module: 2, q: 8, stamped: "b",
    stem: "What does the speaker mainly discuss?", votes: ["C", "c"],
  };

  test("听力：module 对上才改", () => {
    expect(manualAnswerFix([L], AT)).toBe("C");
    expect(manualAnswerFix([L], { ...AT, module: 1 })).toBeNull();
  });

  test("听力条目没写 module → 一律不放行（撞号的另一个 module 不能蹭进来）", () => {
    const noMod = { ...L }; delete noMod.module;
    expect(manualAnswerFix([noMod], AT)).toBeNull();
    expect(manualAnswerFix([noMod], { ...AT, module: 1 })).toBeNull();
    const pass = { ...noMod, verdict: "key_correct" };
    expect(manualAuditPass([pass], { ...AT, stamped: "b" })).toBe(false);
  });

  test("阅读历史条目没写 module → 老行为不变（照旧只认卷/科目/题号/字母/题干）", () => {
    const R = {
      set: "3.30新托福真题", section: "reading", q: 32, stamped: "A", corrected: "D", verdict: "key_corrected",
      stem: "According to the passage, corn plants", reason: "原卷第 2 段：信号由别的玉米植株经根系分泌物发出 → D",
    };
    const at = {
      set: "3.30新托福真题", section: "reading", q: 32, stamped: "a",
      stem: "According to the passage, corn plants may release MBOA", votes: ["D", "d"],
    };
    expect(manualAnswerFix([R], at)).toBe("D");
    expect(manualAnswerFix([R], { ...at, module: 1 })).toBe("D");
    expect(manualAnswerFix([R], { ...at, module: 2 })).toBe("D");
    // 写了 module 的阅读条目仍要逐一相等
    expect(manualAnswerFix([{ ...R, module: 1 }], { ...at, module: 2 })).toBeNull();
    expect(manualAnswerFix([{ ...R, module: 1 }], { ...at, module: 1 })).toBe("D");
  });
});

/**
 * 在线清单 data/realBank/audit-overrides.json 的形状闸：听力条目漏写 module 会静默失效
 * （fail-closed 到「不放行」），肉眼看不出来，所以这里直接查真文件。
 */
describe("audit-overrides.json 形状", () => {
  const fs = require("fs");
  const path = require("path");
  const entries = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/realBank/audit-overrides.json"), "utf8")).entries;

  test("每条都写了依据、卷、科目、题号、答案页字母、题干前缀 ≥12 字符", () => {
    for (const e of entries) {
      expect(typeof e.set).toBe("string");
      expect(["reading", "listening"]).toContain(e.section);
      expect(Number.isFinite(Number(e.q))).toBe(true);
      expect(String(e.stamped)).toMatch(/^[A-D]$/);
      expect(String(e.stem).trim().length).toBeGreaterThanOrEqual(12);
      expect(String(e.reason).trim().length).toBeGreaterThan(20);
      expect(["key_correct", "key_corrected"]).toContain(e.verdict);
      if (e.verdict === "key_corrected") expect(String(e.corrected)).toMatch(/^[A-D]$/);
    }
  });

  test("听力条目必须写 module", () => {
    for (const e of entries.filter((x) => x.section === "listening")) {
      expect([1, 2]).toContain(Number(e.module));
    }
  });
});
