/**
 * 真题丢题归因（scripts/realbank/loss_attribution.js）。
 *
 * 这个账本是「别再靠用户撞见才发现丢题」的仪表盘，所以它自己不能骗人。三条最容易骗人的地方：
 *   1. 沾边就整锅算源料缺陷 —— `duplicate_cluster` 这种纯溯源标记会把管线丢题一口吞掉；
 *   2. 复核扣下按「条」数，但缺口按「题」算 —— 一条 CTW unit 扣的是 10 个空，不是 1 题；
 *   3. sets.json 里**整科缺席**的科目连键都没有，不补进分母的话，
 *      47 套一题都没跑过的听力会显示成「没缺题」。
 * 下面逐条锁死。
 */
const {
  CAUSES,
  parseItemId,
  capFromDetail,
  indexHolds,
  indexDeduped,
  indexSourceFlags,
  findExplainer,
  rowsForSet,
  buildLedger,
  actionableTasks,
} = require("../scripts/realbank/loss_attribution.js");

/** 最小可用的一套卷：阅读 M1 两个槽，填词满、学术段落缺 3。 */
function fixtureSet(overrides = {}) {
  return {
    set: "3.18新托福真题",
    slug: "318",
    date: "2026-03-18",
    sections: {
      reading: {
        got: 17, need: 20,
        modules: {
          1: {
            form: "A",
            slots: [
              { key: "ctw_1", type: "ctw", band: [1, 10], need: 10, got: 10, status: "full" },
              { key: "ap_31", type: "ap", band: [31, 35], need: 5, got: 2, status: "partial" },
              { key: "rdl_21", type: "rdl", band: [21, 30], need: 5, got: 5, status: "full" },
            ],
          },
        },
      },
    },
    ...overrides,
  };
}

const emptyCtx = () => ({
  holdIndex: new Map(), dedupIndex: new Map(), flagIndex: new Map(), defaultSlots: {},
});

describe("parseItemId", () => {
  test("阅读/听力/口语/写作四种 id 形状都能解出 type 与卷 slug", () => {
    expect(parseItemId("real_ap_121a_1_26")).toEqual({ type: "ap", slug: "121a" });
    expect(parseItemId("real_ctw_rp0830_16_1")).toEqual({ type: "ctw", slug: "rp0830" });
    expect(parseItemId("real_lcr_121b_1_01")).toEqual({ type: "lcr", slug: "121b" });
    expect(parseItemId("real_repeat_121a_1")).toEqual({ type: "repeat", slug: "121a" });
    expect(parseItemId("real_ap_56v2_2_11")).toEqual({ type: "ap", slug: "56v2" });
    expect(parseItemId("bs_225_03")).toEqual({ type: "bs", slug: "225" });
    expect(parseItemId("email_rf0615")).toEqual({ type: "email", slug: "rf0615" });
    expect(parseItemId("disc_rp0719")).toEqual({ type: "disc", slug: "rp0719" });
  });

  test("解不出就返回 null，不瞎猜", () => {
    for (const bad of ["", null, undefined, "real", "real_ap", "___"]) expect(parseItemId(bad)).toBeNull();
  });
});

describe("indexHolds", () => {
  test("dup_of 的扣留不算缺口（装卷时按别名原位还回，槽位并不空）", () => {
    const m = indexHolds([
      { file: "reading/ap", id: "real_ap_318_1_31", scope: "unit", dup_of: "real_ap_325_1_26" },
      { file: "reading/ap", id: "real_ap_318_1_31", scope: "unit" },
    ]);
    expect(m.get("ap|318")).toBe(5);        // 只数了没有 dup_of 的那条
  });

  test("scope=unit 按题型折成题数，其余 scope 一条算一题", () => {
    const m = indexHolds([
      { id: "real_ctw_318_1_1", scope: "unit" },       // 一篇填词 = 10 空
      { id: "real_lat_318_1_25", scope: "unit" },      // 一段讲座 = 4 题
      { id: "real_ap_318_1_31", scope: "question" },   // 只扣一题
      { id: "real_repeat_318_1", scope: "sentence" },  // 只扣一句
    ]);
    expect(m.get("ctw|318")).toBe(10);
    expect(m.get("lat|318")).toBe(4);
    expect(m.get("ap|318")).toBe(1);
    expect(m.get("repeat|318")).toBe(1);
  });
});

describe("indexDeduped", () => {
  test("只数 skipped（被判据挡下的），merged 是并进代表了的不算丢", () => {
    const m = indexDeduped([{
      kept: "real_ap_121a_1_26",
      merged: [{ from: "real_ap_34_1_31", q_number: 35 }],
      skipped: [
        { from: "real_ap_48_1_26", reason: "duplicate_options" },
        { from: "real_ap_48_1_26", reason: "over_cap" },
      ],
    }]);
    expect(m.get("ap|48")).toBe(2);
    expect(m.get("ap|34")).toBeUndefined();
  });
});

describe("capFromDetail", () => {
  test("读得出「缺 N 题」，读不出返回 null", () => {
    expect(capFromDetail("writing 科缺 5 题（配对 5／满分 10）。")).toBe(5);
    expect(capFromDetail("reading 科缺 12 题")).toBe(12);
    expect(capFromDetail("答案 PDF 把阅读填词答案词首砍掉")).toBeNull();
    expect(capFromDetail(undefined)).toBeNull();
  });
});

describe("indexSourceFlags", () => {
  test("纯溯源 code 不认领任何缺题，只作为提示挂在行上", () => {
    const m = indexSourceFlags({
      "3.18新托福真题": [
        { code: "duplicate_cluster", severity: "warn", sections: ["*"], detail: "与 3.15… 同题簇" },
        { code: "vendor_pool", severity: "warn", sections: ["*"], detail: "拼盘" },
      ],
    });
    const entry = m.get("3.18新托福真题");
    expect(entry.explainers).toHaveLength(0);
    expect(entry.notes.map((n) => n.code)).toEqual(["duplicate_cluster", "vendor_pool"]);
  });

  test("section_gap 的额度就是 detail 里那个数，多出来的缺口不许再赖给它", () => {
    const m = indexSourceFlags({
      A: [{ code: "section_gap", severity: "warn", sections: ["writing"], detail: "writing 科缺 5 题（配对 5／满分 10）。" }],
    });
    expect(m.get("A").explainers[0].remaining).toBe(5);
  });

  test("整科级 code 无上限；ctw_answer_truncated 只砍填词（AP/RDL 的答案来自选择题答案键）", () => {
    const m = indexSourceFlags({
      A: [
        { code: "section_no_stems", severity: "blocking", sections: ["speaking"], detail: "只配对 0 题" },
        { code: "ctw_answer_truncated", severity: "blocking", sections: ["reading"], detail: "词首被砍" },
      ],
    });
    const [noStems, ctwOnly] = m.get("A").explainers;
    expect(noStems.remaining).toBe(Infinity);
    expect(noStems.types).toBeNull();
    expect(ctwOnly.types.has("ctw")).toBe(true);
    expect(findExplainer(m.get("A"), "reading", "ap")).toBeNull();      // AP 不归它管
    expect(findExplainer(m.get("A"), "reading", "ctw")).toBe(ctwOnly);
  });
});

describe("rowsForSet", () => {
  test("只产出真缺口的行；填满的槽不出现", () => {
    const rows = rowsForSet(fixtureSet(), emptyCtx());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "ap", missing: 3, cause: "pipeline_loss", section: "reading" });
  });

  test("没有任何解释时归到管线丢题 —— 这正是要修的那一桶", () => {
    const rows = rowsForSet(fixtureSet(), emptyCtx());
    expect(rows[0].charged).toEqual({ pipeline_loss: 3 });
  });

  test("源料额度按题扣，扣完的部分仍算管线丢题（不许一个 flag 吞掉整卷）", () => {
    const ctx = {
      ...emptyCtx(),
      flagIndex: indexSourceFlags({
        "3.18新托福真题": [{ code: "section_gap", sections: ["reading"], detail: "reading 科缺 2 题" }],
      }),
    };
    const rows = rowsForSet(fixtureSet(), ctx);
    expect(rows[0].charged).toEqual({ source_defect: 2, pipeline_loss: 1 });
    expect(rows[0].cause).toBe("source_defect");        // 占比大的那个当显示成因
  });

  test("复核扣下与跨卷合并各扣各的额度，优先级 源缺 > 扣下 > 合并 > 管线", () => {
    const ctx = {
      ...emptyCtx(),
      holdIndex: new Map([["ap|318", 1]]),
      dedupIndex: new Map([["ap|318", 1]]),
    };
    const rows = rowsForSet(fixtureSet(), ctx);
    expect(rows[0].charged).toEqual({ held: 1, deduped: 1, pipeline_loss: 1 });
  });

  test("额度只能花一次：同一卷同题型的两个槽不会把同一条扣留重复计两次", () => {
    const set = fixtureSet();
    set.sections.reading.modules[1].slots.push(
      { key: "ap_26", type: "ap", band: [26, 30], need: 5, got: 3, status: "partial" },
    );
    const ctx = { ...emptyCtx(), holdIndex: new Map([["ap|318", 2]]) };
    const rows = rowsForSet(set, ctx).filter((r) => r.type === "ap");
    const held = rows.reduce((a, r) => a + (r.charged.held || 0), 0);
    expect(held).toBe(2);                                // 总共就 2 题的额度
    expect(rows.reduce((a, r) => a + r.missing, 0)).toBe(5);
  });

  test("整科缺席：sets.json 里没有的科目要按蓝图补出槽位，否则「一题都没跑」会显示成「没缺题」", () => {
    const ctx = {
      ...emptyCtx(),
      defaultSlots: {
        reading: [{ key: "ctw_1", type: "ctw", q: 10, module: "1", form: "A" }],
        listening: [
          { key: "lcr_1", type: "lcr", q: 12, module: "1", form: "A" },
          { key: "lat_25", type: "lat", q: 8, module: "1", form: "A" },
        ],
      },
    };
    const rows = rowsForSet(fixtureSet(), ctx);
    const listening = rows.filter((r) => r.section === "listening");
    expect(listening.map((r) => r.type).sort()).toEqual(["lat", "lcr"]);
    // 听力不在管线覆盖范围 → 压根没跑过，不是丢的
    expect(listening.every((r) => r.cause === "section_never_run" && r.got === 0 && r.status === "absent")).toBe(true);
    expect(listening.reduce((a, r) => a + r.missing, 0)).toBe(20);
    // 已经在 sets.json 里的科目不会被默认槽位重复补一遍
    expect(rows.filter((r) => r.section === "reading" && r.type === "ctw")).toHaveLength(0);
  });

  test("整科缺席分两种：管线覆盖的科目 + 这卷确实跑过 = 跑了归零（可扫），不是「没跑过」", () => {
    // fixtureSet 的阅读有题 → 这卷进过管线；写作在管线覆盖内却整科缺席 = 跑了颗粒无收。
    // 实测就是这个形状：24 套写作整科缺席的卷，阅读全都有题。
    const ctx = {
      ...emptyCtx(),
      defaultSlots: {
        writing: [{ key: "bs_1", type: "bs", q: 10, module: "1", form: "A" }],
        speaking: [{ key: "repeat_1", type: "repeat", q: 7, module: "1", form: "A" }],
      },
    };
    const rows = rowsForSet(fixtureSet(), ctx);
    expect(rows.find((r) => r.section === "writing").cause).toBe("section_lost");
    expect(rows.find((r) => r.section === "speaking").cause).toBe("section_never_run");
  });

  test("这卷一科都没进过库时，阅读/写作也算「没跑过」——没有证据说它被跑过", () => {
    const set = fixtureSet();
    set.sections.reading.got = 0;
    set.sections.reading.modules[1].slots.forEach((sl) => { sl.got = 0; });
    const ctx = { ...emptyCtx(), defaultSlots: { writing: [{ key: "bs_1", type: "bs", q: 10, module: "1", form: "A" }] } };
    expect(rowsForSet(set, ctx).find((r) => r.section === "writing").cause).toBe("section_never_run");
  });
});

describe("buildLedger", () => {
  const input = () => ({
    sets: { sets: [fixtureSet()] },
    holds: [{ id: "real_ap_318_1_31", scope: "question" }],
    clusters: [],
    sourceFlags: {},
    defaultSlots: { speaking: [{ key: "repeat_1", type: "repeat", q: 7, module: "1", form: "A" }] },
  });

  test("分母 = sets.json 已有槽位 + 整科缺席补出来的槽位", () => {
    const l = buildLedger(input());
    expect(l.summary.need).toBe(20 + 7);
    expect(l.summary.got).toBe(17);
    expect(l.summary.missing).toBe(10);
  });

  test("缺口按槽位算：某个槽装多了，不许把别处的空冲掉", () => {
    const set = fixtureSet();
    // 复述这种拼盘切出来的份数会超过卷面规格（sets.json 里 repeat 就有 130%）
    set.sections.reading.modules[1].slots.push(
      { key: "over_1", type: "rdl", band: [21, 30], need: 5, got: 9, status: "full" },
    );
    set.sections.reading.got += 9;
    set.sections.reading.need += 5;
    const l = buildLedger({ ...input(), sets: { sets: [set] } });
    expect(l.summary.missing).toBe(10);            // ap 缺 3 + 整科缺席 7，没被多出来的 4 冲掉
    expect(l.summary.overfilled).toBe(4);
    expect(l.summary.got + l.summary.missing - l.summary.overfilled).toBe(l.summary.need);
  });

  test("各桶加起来正好等于缺口总数（账本不许对不平）", () => {
    const l = buildLedger(input());
    const sum = CAUSES.reduce((a, c) => a + (l.summary.causes[c] || 0), 0);
    expect(sum).toBe(l.summary.missing);
  });

  test("按题型与按科目的 need/got 各自对得上总数", () => {
    const l = buildLedger(input());
    const byType = Object.values(l.byType).reduce((a, b) => ({ need: a.need + b.need, got: a.got + b.got }), { need: 0, got: 0 });
    const bySection = Object.values(l.bySection).reduce((a, b) => ({ need: a.need + b.need, got: a.got + b.got }), { need: 0, got: 0 });
    expect(byType).toEqual({ need: l.summary.need, got: l.summary.got });
    expect(bySection).toEqual({ need: l.summary.need, got: l.summary.got });
  });

  test("没有输入也不炸（空账本而不是异常）", () => {
    const l = buildLedger({});
    expect(l.summary).toMatchObject({ need: 0, got: 0, missing: 0, completeness: 1 });
    expect(l.rows).toEqual([]);
  });
});

describe("actionableTasks", () => {
  test("只聚可执行的两桶，按缺口从大到小；源缺/扣下不进清单", () => {
    const rows = [
      { set: "A", slug: "a", date: "1", section: "reading", module: "1", slotKey: "ctw_1", type: "ctw", missing: 10, charged: { pipeline_loss: 10 } },
      { set: "A", slug: "a", date: "1", section: "reading", module: "1", slotKey: "ap_31", type: "ap", missing: 2, charged: { pipeline_loss: 2 } },
      { set: "B", slug: "b", date: "2", section: "writing", module: "1", slotKey: "bs_1", type: "bs", missing: 9, charged: { source_defect: 9 } },
      { set: "C", slug: "c", date: "3", section: "writing", module: "1", slotKey: "bs_1", type: "bs", missing: 12, charged: { section_lost: 12 } },
      { set: "D", slug: "d", date: "4", section: "listening", module: "1", slotKey: "lcr_1", type: "lcr", missing: 15, charged: { section_never_run: 15 } },
    ];
    const tasks = actionableTasks(rows);
    // 源缺不进清单；「整科没跑过」是铺量决策，也不进
    expect(tasks.map((t) => `${t.set}/${t.section}`)).toEqual(["A/reading", "C/writing"]);
    expect(tasks[0]).toMatchObject({ missing: 12, cause: "pipeline_loss", types: { ctw: 10, ap: 2 } });
    expect(tasks[1].cause).toBe("section_lost");
  });

  test("一行里混着两种成因时，只把可执行的那部分计入任务量", () => {
    const rows = [{
      set: "A", slug: "a", date: "1", section: "reading", module: "1", slotKey: "ap_31",
      type: "ap", missing: 5, charged: { source_defect: 3, pipeline_loss: 2 },
    }];
    expect(actionableTasks(rows)[0].missing).toBe(2);
  });
});

describe("落库丢弃（bank_dropped，读 drop-ledger.json）", () => {
  // 2026-09-14 以前这一桶不存在：结构化抽出来了、却在 build_bank 被闸扔掉的题，全被笼统算成「管线丢题」，
  // 于是作业单叫人去重扫结构化 —— 可重扫治不了盲审不一致、选项残缺、整科被扣。
  const { makeDropRecorder, indexDropsForAttribution } = require("../scripts/realbank/drop_ledger.js");
  const dropCtx = (rows) => ({ ...emptyCtx(), dropIndex: indexDropsForAttribution(rows) });

  test("排在跨卷合并之后、管线丢题之前；额度按题扣，扣完的仍算管线丢题", () => {
    const rec = makeDropRecorder();
    rec.drop({ set: "3.18新托福真题", slug: "318", type: "ap", q: 33, n: 1, code: "droppedDisagree" });
    const ctx = { ...dropCtx(rec.rows), dedupIndex: new Map([["ap|318", 1]]) };
    const [row] = rowsForSet(fixtureSet(), ctx);
    expect(row.charged).toEqual({ deduped: 1, bank_dropped: 1, pipeline_loss: 1 });
    expect(row.drop_codes).toEqual({ droppedDisagree: 1 });
    expect(CAUSES.indexOf("bank_dropped")).toBe(CAUSES.indexOf("deduped") + 1);
  });

  test("阅读 ap / rdl 同卷额度互通（落库时还没按考卷位置归位，丢弃行上的题型可能与槽位对调）", () => {
    const rec = makeDropRecorder();
    rec.drop({ set: "3.18新托福真题", slug: "318", type: "rdl", q: 33, n: 2, code: "droppedBadOptions" });
    const [row] = rowsForSet(fixtureSet(), dropCtx(rec.rows));
    expect(row.charged).toEqual({ bank_dropped: 2, pipeline_loss: 1 });
  });

  test("听力等别的科目不互通：lc 的丢弃不能认领 lat 的缺口", () => {
    const set = fixtureSet({
      sections: { listening: { got: 0, need: 4, modules: { 1: { form: "A", slots: [{ key: "lat_25", type: "lat", need: 4, got: 0, status: "empty" }] } } } },
    });
    const rec = makeDropRecorder();
    rec.drop({ set: "3.18新托福真题", slug: "318", section: "listening", type: "lc", n: 2, code: "lDroppedInvalid" });
    const [row] = rowsForSet(set, dropCtx(rec.rows));
    expect(row.charged.bank_dropped).toBeUndefined();
  });

  test("整科丢弃（整科被扣 / 整份源文件重复）不设上限，行上记原因码", () => {
    const rec = makeDropRecorder();
    rec.drop({ set: "3.18新托福真题", slug: "318", section: "reading", code: "droppedDupSet", detail: "与 3.15 相同" });
    const [row] = rowsForSet(fixtureSet(), dropCtx(rec.rows));
    expect(row.charged).toEqual({ bank_dropped: 3 });
    expect(row.drop_codes).toEqual({ droppedDupSet: null });
  });

  test("额度只能花一次：同卷同题型两个槽共用一份丢弃额度", () => {
    const set = fixtureSet();
    set.sections.reading.modules[1].slots.push({ key: "ap_26", type: "ap", band: [26, 30], need: 5, got: 3, status: "partial" });
    const rec = makeDropRecorder();
    rec.drop({ set: "3.18新托福真题", slug: "318", type: "ap", n: 2, code: "droppedDisagree" });
    const rows = rowsForSet(set, dropCtx(rec.rows)).filter((r) => r.type === "ap");
    expect(rows.reduce((a, r) => a + (r.charged.bank_dropped || 0), 0)).toBe(2);
  });

  test("buildLedger 不给 drops 时行为与接线前完全一致（这一桶恒 0）；给了之后恒等式照样对得平", () => {
    const sets = { sets: [fixtureSet()] };
    const without = buildLedger({ sets });
    expect(without.summary.causes.bank_dropped).toBe(0);
    const rec = makeDropRecorder();
    rec.drop({ set: "3.18新托福真题", slug: "318", type: "ap", n: 1, code: "droppedNoAudit" });
    const withDrops = buildLedger({ sets, drops: rec.rows });
    expect(withDrops.summary.causes).toMatchObject({ bank_dropped: 1, pipeline_loss: 2 });
    const sum = CAUSES.reduce((a, c) => a + (withDrops.summary.causes[c] || 0), 0);
    expect(sum).toBe(withDrops.summary.missing);
  });

  test("落库丢弃不算「重扫能捡」的可执行任务", () => {
    const tasks = actionableTasks([
      { set: "A", slug: "a", date: "1", section: "reading", module: "1", slotKey: "ap_31", type: "ap", missing: 3, charged: { bank_dropped: 3 } },
    ]);
    expect(tasks).toEqual([]);
  });
});
