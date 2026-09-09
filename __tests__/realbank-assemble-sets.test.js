/**
 * 真题「装回整卷」的回归测试（lib/realExam/blueprint.mjs + scripts/realbank/assemble_sets.mjs）。
 *
 * 不碰真实题库（数字天天变），用一个手写的迷你题库跑**真正会被跑的那个脚本**，锁住四件坏了最贵的事：
 *   1. id → (卷, module, 题号) 的解析与归一（rf 卷阅读 121 → 21；拼盘 rp* 不锚定）；
 *   2. 阅读 M1 按位置修正题型（起步 23 的 3 题「ap」其实是日常阅读）与 A/B 版式判定；
 *   3. 原卷回填：每道题落在对的槽位，完整度算对；
 *   4. 拼卷：空槽从拼盘 / 被拆散的弱卷借题、借来的题带出处、拼盘大集按 7 句 / 4 问切分、
 *      「拼齐」必须每个槽都至少近似满（缺讨论题的写作卷不算齐）。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const bp = require("../lib/realExam/blueprint.mjs");
const asm = require("../scripts/realbank/assemble_sets.mjs");

describe("blueprint: id 解析与位置修正", () => {
  test("parseRealBankId 认得四种 id 形状", () => {
    expect(bp.parseRealBankId("real_lcr_121b_1_01")).toEqual({ type: "lcr", slug: "121b", module: 1, q: 1 });
    expect(bp.parseRealBankId("real_rdl_rf0610_1_121")).toEqual({ type: "rdl", slug: "rf0610", module: 1, q: 121 });
    expect(bp.parseRealBankId("bs_225_03")).toEqual({ type: "bs", slug: "225", module: 1, q: 3 });
    expect(bp.parseRealBankId("email_rf0615")).toEqual({ type: "email", slug: "rf0615", module: 1, q: null });
    expect(bp.parseRealBankId("real_repeat_rf0610_1")).toEqual({ type: "repeat", slug: "rf0610", module: 1, q: null, seq: 1 });
    expect(bp.parseRealBankId("usr_ctw_abc")).toBeNull();
  });

  test("normalizeQ：rf 卷阅读题号去掉 module 百位前缀，拼盘伪题号作废", () => {
    expect(bp.normalizeQ(121, { module: 1 })).toBe(21);
    expect(bp.normalizeQ(211, { module: 2 })).toBe(11);
    expect(bp.normalizeQ(200131, { module: 2001 })).toBeNull();
    expect(bp.normalizeQ(7, { module: 1 })).toBe(7);
  });

  test("positionType：M1 起步 23/25/28 且 ≤3 题的 ap 是日常阅读；26/31 起步才是学术段落", () => {
    expect(bp.positionType("ap", { module: 1, q: 23, nq: 3 })).toBe("rdl");
    expect(bp.positionType("ap", { module: 1, q: 25, nq: 3 })).toBe("rdl");
    expect(bp.positionType("ap", { module: 1, q: 26, nq: 3 })).toBe("ap");
    expect(bp.positionType("ap", { module: 1, q: 31, nq: 5 })).toBe("ap");
    expect(bp.positionType("ap", { module: 2, q: 11, nq: 4 })).toBe("ap");
    expect(bp.positionType("rdl", { module: 1, q: 23, nq: 3 })).toBe("rdl");
    // 体裁证据优先：topic 落成 email / notice 的 ap，就算起步 26 也是日常阅读
    expect(bp.positionType("ap", { module: 1, q: 26, nq: 3, genre: "email" })).toBe("rdl");
    expect(bp.positionType("ap", { module: 1, q: 28, nq: 2, genre: "Notice" })).toBe("rdl");
    expect(bp.positionType("ap", { module: 1, q: 31, nq: 5, genre: "biology" })).toBe("ap");
  });

  test("版式判定", () => {
    expect(bp.detectReadingM1Form([{ module: 1, type: "ap", q: 26 }])).toBe("B");
    expect(bp.detectReadingM1Form([{ module: 1, type: "ap", q: 31 }])).toBe("A");
    expect(bp.detectListeningM2Form([{ module: 2, type: "lcr", q: 5 }])).toBe("B");
    expect(bp.detectListeningM2Form([{ module: 2, type: "la", q: 12 }])).toBe("B");
    expect(bp.detectListeningM2Form([{ module: 2, type: "lcr", q: 3 }, { module: 2, type: "lat", q: 12 }])).toBe("A");
  });

  test("蓝图总题数：阅读 35+15 / 听力 32+15 / 口语 11 / 写作 12，每种版式槽位题数加起来等于 module 总数", () => {
    for (const [section, def] of Object.entries(bp.EXAM_2026)) {
      let total = 0;
      for (const [mod, m] of Object.entries(def.modules)) {
        for (const [form, slots] of Object.entries(m.forms)) {
          const sum = slots.reduce((a, s) => a + s.q, 0);
          expect({ section, mod, form, sum }).toEqual({ section, mod, form, sum: m.total });
        }
        total += m.total;
      }
      expect(total).toBe(def.total);
    }
  });
});

/* ── 迷你题库 ────────────────────────────────────────────────────────── */

const Q = (n) => Array.from({ length: n }, (_, i) => ({ question: `q${i + 1}`, options: { A: "a", B: "b", C: "c", D: "d" }, answer: "A" }));
const ctw = (id, source, date) => ({ id, source, date, blanks: Array.from({ length: 10 }, (_, i) => ({ position: i, answer: "x" })), blank_count: 10, passage: "p" });
const mcq = (id, source, date, n) => ({ id, source, date, questions: Q(n) });
const one = (id, source, date, extra = {}) => ({ id, source, date, ...extra });

function writeMiniBank(dir) {
  const S1 = "1.21新托福真题A卷", S2 = "2.2新托福真题", S3 = "3.25新托福真题", RF = "rf0620", RP = "rp0704";
  const d1 = "2026-01-21", d2 = "2026-02-02", d3 = "2026-03-25", dr = "2026-06-20", dp = "2026-07-04";
  const banks = {
    // 阅读：S1 几乎整卷（B 型）；S3 只有几道日常阅读（含起步 23 的伪 ap）→ 会被拆散给 S1 补 M2 学术段落
    ctw: [ctw("real_ctw_121a_1_1", S1, d1), ctw("real_ctw_121a_1_11", S1, d1), ctw("real_ctw_121a_2_1", S1, d1), ctw("real_ctw_rf0620_1_1", RF, dr)],
    rdl: [mcq("real_rdl_121a_1_21", S1, d1, 2), mcq("real_rdl_121a_1_23", S1, d1, 3), mcq("real_rdl_325_1_21", S3, d3, 2), mcq("real_rdl_rf0620_1_121", RF, dr, 2)],
    ap: [mcq("real_ap_121a_1_26", S1, d1, 5), mcq("real_ap_121a_1_31", S1, d1, 5), mcq("real_ap_325_1_23", S3, d3, 3), mcq("real_ap_325_2_11", S3, d3, 5), mcq("real_ap_rp0704_1001_100101", RP, dp, 4)],
    // 听力：S2 M1 全 + M2 A 型缺 lc_6；S1 只有 M2 一段对话（弱）→ 被拆散补 S2
    lcr: [
      ...Array.from({ length: 12 }, (_, i) => one(`real_lcr_22_1_${String(i + 1).padStart(2, "0")}`, S2, d2, { answer: "A" })),
      ...Array.from({ length: 3 }, (_, i) => one(`real_lcr_22_2_${String(i + 1).padStart(2, "0")}`, S2, d2, { answer: "A" })),
    ],
    lc: [mcq("real_lc_22_1_13", S2, d2, 2), mcq("real_lc_22_1_15", S2, d2, 2), mcq("real_lc_22_1_17", S2, d2, 2), mcq("real_lc_22_2_04", S2, d2, 2), mcq("real_lc_121a_2_06", S1, d1, 2)],
    la: [mcq("real_la_22_1_19", S2, d2, 2), mcq("real_la_22_1_21", S2, d2, 2), mcq("real_la_22_1_23", S2, d2, 2)],
    lat: [mcq("real_lat_22_1_25", S2, d2, 4), mcq("real_lat_22_1_29", S2, d2, 4), mcq("real_lat_22_2_08", S2, d2, 4), mcq("real_lat_22_2_12", S2, d2, 3)],
    // 口语：RF 只有 5 句复述（partial）→ 用拼盘 14 句（7 的整数倍）切出的 7 句替换
    repeat: [
      one("real_repeat_rf0620_1", RF, dr, { sentences: Array.from({ length: 5 }, (_, i) => ({ id: `rf_s${i + 1}`, sentence: `s${i + 1}` })) }),
      one("real_repeat_rp0704_1", RP, dp, { sentences: Array.from({ length: 14 }, (_, i) => ({ id: `rp_s${i + 1}`, sentence: `s${i + 1}` })) }),
    ],
    // 面试：4 问的拼盘可直接用；19 问的拼盘是几场面试缝在一起，不许机械切
    interview: [
      one("real_interview_rp0704_1", RP, dp, { questions: Array.from({ length: 19 }, (_, i) => ({ id: `rp_q${i + 1}`, question: `q${i + 1}` })) }),
      one("real_interview_rp0812_1", "rp0812", "2026-08-12", { questions: Array.from({ length: 4 }, (_, i) => ({ id: `rp8_q${i + 1}`, question: `q${i + 1}` })) }),
    ],
    // 写作：RF 10 句 + 邮件，没有讨论题 → 不算拼齐
    bs: Array.from({ length: 10 }, (_, i) => one(`bs_rf0620_${String(i + 1).padStart(2, "0")}`, RF, dr, { prompt: "p" })),
    email: [one("email_rf0620", RF, dr)],
    disc: [],
  };
  for (const [type, rel] of Object.entries(asm.BANK_FILES)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ items: banks[type] }));
  }
  fs.writeFileSync(path.join(dir, "source-flags.json"), JSON.stringify({ sets: { [S1]: [{ code: "duplicate_cluster", severity: "warn", sections: ["*"], detail: `与 ${S3} 属同题簇` }] } }));
  return { S1, S2, S3, RF, RP };
}

describe("assemble_sets：迷你题库端到端", () => {
  let dir, names, man;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "realbank-sets-"));
    names = writeMiniBank(dir);
    // 这一组测的是借题拼卷（--borrow）；默认的同源不借见下一组
    man = asm.buildManifest(dir, { borrow: true });
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const setOf = (name) => man.sets.find((s) => s.set === name);
  const slotOf = (sec, mod, key) => sec.modules[mod].slots.find((s) => s.key === key);

  test("原卷回填：S1 阅读判成 B 型，M1 35/35 满，M2 只有填词 → 45/50", () => {
    const r = setOf(names.S1).sections.reading;
    expect(r.modules[1].form).toBe("B");
    expect(r.modules[1].got).toBe(35);
    expect(slotOf(r, 1, "rdl_21").items.map((x) => x.id)).toEqual(["real_rdl_121a_1_21", "real_rdl_121a_1_23"]);
    expect(slotOf(r, 2, "ap_11").status).toBe("empty");
    expect(r.got).toBe(45);
    expect(r.completeness).toBe(0.9);
  });

  test("位置修正：S3 起步 23 的 3 题 ap 落进日常阅读带，而不是学术槽", () => {
    const r = setOf(names.S3).sections.reading;
    expect(slotOf(r, 1, "rdl_21").items.map((x) => x.id)).toEqual(["real_rdl_325_1_21", "real_ap_325_1_23"]);
    expect(r.modules[1].form).toBe("A");
    expect(r.unplaced).toEqual([]);
  });

  test("拼盘 rp* 不锚定：不出现在 sets 里，只当素材", () => {
    expect(setOf(names.RP)).toBeUndefined();
    expect(man.pool_items).toEqual({ ap: 1, repeat: 1, interview: 2 });
    expect(man.unanchored).toEqual([]);
  });

  test("拼卷阅读：S1 从被拆散的同簇弱卷 S3 借到 M2 学术段落 → 拼齐，借题带出处", () => {
    const c = man.composites.reading.find((x) => x.base_set === names.S1);
    expect(c.complete).toBe(true);
    expect(c.completeness).toBe(1);
    expect(c.borrowed).toEqual([{ slot: "ap_11", id: "real_ap_325_2_11", nq: 5, q: 11, from: names.S3, via: "dissolved" }]);
    expect(c.purity).toBe(0.9);
    expect(man.composites.reading.some((x) => x.base_set === names.S3)).toBe(false);
  });

  test("拼卷听力：S2 缺的 M2 第二段对话从弱卷 S1 借来；lat_12 只有 3 题算近似满", () => {
    const c = man.composites.listening.find((x) => x.base_set === names.S2);
    expect(c.borrowed.map((b) => [b.slot, b.id])).toEqual([["lc_6", "real_lc_121a_2_06"]]);
    expect(slotOf(c, 2, "lat_12").status).toBe("near");
    expect(c.complete).toBe(true);
    expect(c.missing).toEqual(["M2/lat_12:3/4"]);
  });

  test("拼卷口语：5 句的复述被拼盘切出的 7 句替换；面试只用恰 4 问的拼盘，19 问的整条作废", () => {
    const c = man.composites.speaking.find((x) => x.base_set === names.RF);
    const rep = slotOf(c, 1, "repeat_1").items[0];
    expect(rep.id).toBe("real_repeat_rp0704_1#c1");
    expect(rep.split).toEqual({ from: "real_repeat_rp0704_1", ids: ["rp_s1", "rp_s2", "rp_s3", "rp_s4", "rp_s5", "rp_s6", "rp_s7"], range: [1, 7] });
    const iv = slotOf(c, 1, "interview_8").items[0];
    expect(iv.id).toBe("real_interview_rp0812_1");
    expect(iv.nq).toBe(4);
    expect(c.complete).toBe(true);
    expect(c.purity).toBe(0);
    expect(man.pool_unsplit).toEqual([{ id: "real_interview_rp0704_1", type: "interview", n: 19 }]);
  });

  test("拼齐必须每槽都在：写作缺讨论题 → 11/12 过了 90% 也不算齐", () => {
    const c = man.composites.writing.find((x) => x.base_set === names.RF);
    expect(c.completeness).toBeCloseTo(11 / 12, 3);
    expect(c.complete).toBe(false);
    expect(c.missing).toEqual(["M1/disc_12:0/1"]);
  });

  test("整卷：没有一套四科都齐 → 0 native；mixed 受最少的那科限制", () => {
    expect(man.summary.exams_native).toBe(0);
    expect(man.summary.exams_mixed).toBe(0);
    expect(man.summary.per_section.reading.composites_complete).toBe(1);
    expect(man.summary.per_section.listening.composites_complete).toBe(1);
    expect(man.summary.per_section.speaking.composites_complete).toBe(1);
    expect(man.summary.per_section.writing.composites_complete).toBe(0);
  });

  test("renderReport 产出含结构表与每科拼卷表", () => {
    const md = asm.renderReport(man);
    expect(md).toContain("## 一、2026 改后整卷结构");
    expect(md).toContain("### reading");
    expect(md).toContain(names.S1);
  });
});

describe("assemble_sets：默认同源不借 + 跨套重复别名 + 题型套", () => {
  let dir, names, man;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "realbank-sets-native-"));
    names = writeMiniBank(dir);
    // 复核清单：S1 的 M2 学术段落曾与 S3 那篇同材料被下架（库里只留 S3 那份）
    fs.writeFileSync(path.join(dir, "review-holds.json"), JSON.stringify({ holds: [
      { file: "reading/ap", id: "real_ap_121a_2_11", scope: "unit", reason: "与 real_ap_325_2_11 同一份材料（跨套重复），保留 real_ap_325_2_11", dup_of: "real_ap_325_2_11" },
      { file: "reading/ap", id: "real_ap_nope_1_31", scope: "unit", reason: "指向不存在的题", dup_of: "real_ap_missing" },
      { file: "reading/rdl", id: "real_rdl_325_1_21", scope: "question", reason: "单题下架不算别名", dup_of: "real_rdl_121a_1_21" },
    ] }));
    man = asm.buildManifest(dir);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const setOf = (name) => man.sets.find((s) => s.set === name);
  const slotOf = (sec, mod, key) => sec.modules[mod].slots.find((s) => s.key === key);

  test("别名原位还回：S1 的 M2 学术段落用 S3 那份的内容，标 alias_of；坏别名/单题下架不算", () => {
    expect(man.params.borrow).toBe(false);
    expect(man.summary.aliases_restored).toBe(1);
    const r = setOf(names.S1).sections.reading;
    expect(slotOf(r, 2, "ap_11").items).toEqual([{ id: "real_ap_325_2_11", nq: 5, q: 11, alias_of: "real_ap_121a_2_11" }]);
    expect(r.completeness).toBe(1);
    // S3 自己那份还在
    expect(slotOf(setOf(names.S3).sections.reading, 2, "ap_11").items.map((x) => x.id)).toEqual(["real_ap_325_2_11"]);
  });

  test("不借：拼卷 = 原卷自己，purity 1、无 borrowed，弱卷不被拆散", () => {
    const c1 = man.composites.reading.find((x) => x.base_set === names.S1);
    expect(c1.complete).toBe(true);
    expect(c1.purity).toBe(1);
    expect(c1.borrowed).toEqual([]);
    expect(man.composites.reading.some((x) => x.base_set === names.S3)).toBe(true);
    expect(man.summary.per_section.reading.dissolved).toBe(0);
    const lis = man.composites.listening.find((x) => x.base_set === names.S2);
    expect(lis.complete).toBe(false);
    expect(lis.missing).toContain("M2/lc_6:0/2");
  });

  test("题型套：一套 = 该场该题型全部题，如实标 got/need，状态沿用槽位语义", () => {
    const apS1 = man.type_sets.ap.find((x) => x.set === names.S1);
    expect(apS1).toMatchObject({ id: "ap:121a", need: 15, got: 15, status: "full" });
    expect(apS1.items.map((x) => [x.module, x.q, x.id, x.alias_of || null])).toEqual([
      [1, 26, "real_ap_121a_1_26", null], [1, 31, "real_ap_121a_1_31", null], [2, 11, "real_ap_325_2_11", "real_ap_121a_2_11"],
    ]);
    const lcS2 = man.type_sets.lc.find((x) => x.set === names.S2);
    expect(lcS2).toMatchObject({ need: 10, got: 8, status: "partial" });
    const latS2 = man.type_sets.lat.find((x) => x.set === names.S2);
    expect(latS2).toMatchObject({ need: 16, got: 15, status: "near" });
    const bsRF = man.type_sets.bs.find((x) => x.set === names.RF);
    expect(bsRF).toMatchObject({ need: 10, got: 10, status: "full" });
    expect(man.summary.type_sets.ap).toEqual({ sets: 2, full: 1, near: 0, partial: 1 });
    // 拼盘 rp* 不出题型套
    expect(man.type_sets.ap.some((x) => x.set === names.RP)).toBe(false);
  });

  test("报告含题型套一节", () => {
    const md = asm.renderReport(man);
    expect(md).toContain("## 六、按题型组套（同源，不借）");
    expect(md).toContain("同源不借");
  });
});

