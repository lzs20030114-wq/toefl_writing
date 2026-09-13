/**
 * 真题阅读「条目 id 沿用」的锁（scripts/realbank/id_carry.js）。
 *
 * AP/RDL 的 id 带着「组内最小题号」，而源料会长：补回一道更靠前的题，27 就变 26，
 * 整条 item 改名。改名会让 data/realBank/review-holds.json 按 id 记的下架/patch 静默失配
 * （实测把 real_ap_56_1_32 改成 _31 之后，两条 dup_of 指针当场落空，
 *  __tests__/real-bank-review-holds.test.js 的「dup_of 指向的那条必须还在库里」直接报红），
 * 用户侧错题本/练习记录也按 id 关联。所以同一篇材料一律沿用上一版的 id。
 *
 * 这里锁三件事：补题后 id 不变 / 新篇正常生成 / 一个旧 id 只许被沿用一次。
 */
const { carryItemIds, idParts } = require("../scripts/realbank/id_carry.js");

/* ── fixture ───────────────────────────────────────────────────────────── */

// 20 个长度 > 3 的词；两份正文共享它们、各自再加几个词，用来调 Jaccard。
const SHARED = "urban noise pollution affects millions residents across modern metropolitan regions researchers measured decibel levels highways during morning commuting hours barriers";
const body = (extra) => `Noise Control in Urban Areas\n\n${SHARED}. ${extra}.`;
const SAME = "acoustic panels reduce reflected energy";            // 与自身逐字相同
const NEAR = "acoustic panels reduce reflected";                    // 少一个词 → Jaccard 20+4 vs 20+5 ≈ 0.96
const FAR = "deep ocean hydrothermal vents support chemosynthetic communities beside superheated mineral plumes beneath sunlight";

const ap = (id, text, questions = 1) => ({
  id, passage: text, paragraphs: text.split("\n\n"),
  questions: Array.from({ length: questions }, (_, i) => ({ stem: `q${i}`, options: { A: "a", B: "b", C: "c", D: "d" }, correct_answer: "A", q_number: i + 1 })),
});
const rdl = (id, text) => ({ id, text, questions: [{ stem: "q", options: { A: "a", B: "b", C: "c", D: "d" }, correct_answer: "A", q_number: 1 }] });
const ids = (list) => list.map((x) => x.id);

/* ── id 形状 ───────────────────────────────────────────────────────────── */

describe("idParts：从 id 里抠 slug / module / 题号", () => {
  test("三种 slug 形状都认得（旧源 / rf 整卷 / rp 拼盘）", () => {
    expect(idParts("real_ap_128a_1_27")).toEqual({ type: "ap", slug: "128a", module: "1", q: 27 });
    expect(idParts("real_rdl_rf0610_1_121")).toEqual({ type: "rdl", slug: "rf0610", module: "1", q: 121 });
    expect(idParts("real_ap_rp0704_2002_200231")).toEqual({ type: "ap", slug: "rp0704", module: "2002", q: 200231 });
    expect(idParts("real_ap_510v2_1_31")).toEqual({ type: "ap", slug: "510v2", module: "1", q: 31 });
  });

  test("形状不对的一律 null（不参与沿用，宁可不认也不认错）", () => {
    expect(idParts("real_ap_523_undefined_34")).toBeNull();   // 历史遗留的构建缺陷 id
    expect(idParts("real_ctw_128a_1_1")).toBeNull();          // 只管 ap/rdl
    expect(idParts("")).toBeNull();
    expect(idParts(null)).toBeNull();
  });
});

/* ── 沿用 ─────────────────────────────────────────────────────────────── */

describe("carryItemIds", () => {
  test("补回更靠前的题让题号从 27 掉到 26：材料没变 → 沿用旧 id", () => {
    const prev = { ap: [ap("real_ap_128a_1_27", body(SAME), 1)], rdl: [] };
    const next = { ap: [ap("real_ap_128a_1_26", body(SAME), 3)], rdl: [] };
    const r = carryItemIds(prev, next);
    expect(r.carried).toBe(1);
    expect(r.renamed).toEqual([{ from: "real_ap_128a_1_26", to: "real_ap_128a_1_27" }]);
    expect(ids(next.ap)).toEqual(["real_ap_128a_1_27"]);
    expect(next.ap[0].questions).toHaveLength(3);             // 题还是新的 3 道，只是 id 沿用
    expect(r.conflicts).toEqual([]);
  });

  test("材料被重新 OCR 略有出入（Jaccard ≥0.8）也认得出是同一篇", () => {
    const prev = { ap: [ap("real_ap_128a_1_27", body(SAME))], rdl: [] };
    const next = { ap: [ap("real_ap_128a_1_26", body(NEAR))], rdl: [] };
    expect(carryItemIds(prev, next).carried).toBe(1);
    expect(ids(next.ap)).toEqual(["real_ap_128a_1_27"]);
  });

  test("新篇正常生成：旧库里没有同 slug/module 的同篇 → id 不动", () => {
    const prev = { ap: [ap("real_ap_128a_1_27", body(SAME))], rdl: [] };
    const next = { ap: [ap("real_ap_128a_1_31", body(FAR)), ap("real_ap_53_1_26", body(SAME))], rdl: [] };
    const r = carryItemIds(prev, next);
    expect(r.carried).toBe(0);                                 // 一篇内容对不上、一篇卷号对不上
    expect(ids(next.ap)).toEqual(["real_ap_128a_1_31", "real_ap_53_1_26"]);
  });

  test("跨 slug / 跨 module 不串：同一篇文章出现在另一场考试里也各归各的 id", () => {
    const prev = { ap: [ap("real_ap_128a_1_27", body(SAME))], rdl: [] };
    const next = { ap: [ap("real_ap_128a_2_11", body(SAME))], rdl: [] };
    expect(carryItemIds(prev, next).carried).toBe(0);
  });

  test("一对多：两条新 item 都像同一条旧 item → 只有最像的那条沿用，另一条报警告", () => {
    const prev = { ap: [ap("real_ap_128a_1_27", body(SAME))], rdl: [] };
    const next = { ap: [ap("real_ap_128a_1_24", body(NEAR)), ap("real_ap_128a_1_26", body(SAME))], rdl: [] };
    const r = carryItemIds(prev, next);
    expect(r.carried).toBe(1);
    expect(r.renamed).toEqual([{ from: "real_ap_128a_1_26", to: "real_ap_128a_1_27" }]);  // 逐字相同的那条赢
    expect(ids(next.ap)).toEqual(["real_ap_128a_1_24", "real_ap_128a_1_27"]);
    expect(r.conflicts).toEqual([{ id: "real_ap_128a_1_24", wanted: "real_ap_128a_1_27", why: "旧 id 已被同桶里更像的一条沿用" }]);
  });

  test("撞 id 就撤回：沿用会把另一条没改名的顶掉时，宁可不沿用", () => {
    // 新库里已经有一条天生叫 real_ap_128a_1_27 的（内容是另一篇），另一条想沿用这个 id
    const prev = { ap: [ap("real_ap_128a_1_27", body(SAME))], rdl: [] };
    const next = { ap: [ap("real_ap_128a_1_26", body(NEAR)), ap("real_ap_128a_1_27", body(FAR))], rdl: [] };
    const r = carryItemIds(prev, next);
    expect(r.carried).toBe(0);
    expect(ids(next.ap)).toEqual(["real_ap_128a_1_26", "real_ap_128a_1_27"]);
    expect(r.conflicts.map((c) => c.id)).toEqual(["real_ap_128a_1_26"]);
    expect(r.conflicts[0].why).toContain("撞 id");
  });

  test("RDL 走同一套（材料字段是 text 不是 passage）", () => {
    const prev = { ap: [], rdl: [rdl("real_rdl_318_1_22", body(SAME))] };
    const next = { ap: [], rdl: [rdl("real_rdl_318_1_21", body(SAME))] };
    expect(carryItemIds(prev, next).carried).toBe(1);
    expect(ids(next.rdl)).toEqual(["real_rdl_318_1_22"]);
  });

  test("ap 与 rdl 不跨文件认（题型翻了就重新生成 id，免得 id 前缀与所在库对不上）", () => {
    const prev = { ap: [ap("real_ap_128a_1_27", body(SAME))], rdl: [] };
    const next = { ap: [], rdl: [rdl("real_rdl_128a_1_26", body(SAME))] };
    expect(carryItemIds(prev, next).carried).toBe(0);
  });

  test("幂等：对沿用过的产物再跑一遍是 no-op", () => {
    const prev = { ap: [ap("real_ap_128a_1_27", body(SAME))], rdl: [] };
    const next = { ap: [ap("real_ap_128a_1_26", body(SAME), 3)], rdl: [] };
    carryItemIds(prev, next);
    const again = carryItemIds(prev, next);
    expect(again.carried).toBe(0);
    expect(again.conflicts).toEqual([]);
    expect(ids(next.ap)).toEqual(["real_ap_128a_1_27"]);
  });

  test("空库 / 缺字段不抛", () => {
    expect(() => carryItemIds(undefined, undefined)).not.toThrow();
    expect(carryItemIds({}, { ap: [], rdl: [] })).toMatchObject({ carried: 0, renamed: [], conflicts: [] });
    expect(() => carryItemIds({ ap: [{ id: "real_ap_128a_1_27" }] }, { ap: [{ id: "real_ap_128a_1_26" }] })).not.toThrow();
  });
});

/* ── 按题号认领清单 id ─────────────────────────────────────────────────── */

describe("claimReferencedIds：被下架的条目从来不在线，id 沿用认不回它 → 按题号认领", () => {
  const { claimReferencedIds } = require("../scripts/realbank/id_carry.js");
  const withQs = (id, text, qs) => ({ ...ap(id, text), questions: qs.map((n) => ({ stem: `q${n}`, options: { A: `a${n}`, B: "b", C: "c", D: "d" }, correct_answer: "A", q_number: n })) });
  const unit = (file, id, extra = {}) => ({ file, id, scope: "unit", reason: "材料坏了", ...extra });

  test("补回更靠前的题、组 id 从 _33 改名成 _31：清单按 _33 记的整条下架照样认领回来（Opal 实例）", () => {
    const bundle = { ap: [withQs("real_ap_21a_1_31", body(SAME), [31, 33, 34])], rdl: [] };
    const r = claimReferencedIds(bundle, { holds: [unit("reading/ap", "real_ap_21a_1_33")] });
    expect(ids(bundle.ap)).toEqual(["real_ap_21a_1_33"]);
    expect(r.claimed).toEqual([{ from: "real_ap_21a_1_31", to: "real_ap_21a_1_33", ref: "real_ap_21a_1_33", source: "unit", also: [] }]);
    expect(r.edges).toEqual([]);                              // 同 kind：精确 id，applyReview / 合并直接生效
  });

  test("题号不在自有题里、或 slug / module 不同 → 不认领", () => {
    const bundle = { ap: [withQs("real_ap_21a_1_31", body(SAME), [31, 32])], rdl: [] };
    const r = claimReferencedIds(bundle, { holds: [
      unit("reading/ap", "real_ap_21a_1_33"), unit("reading/ap", "real_ap_21b_1_31"), unit("reading/ap", "real_ap_21a_2_31"),
    ] });
    expect(r.claimed).toEqual([]);
    expect(ids(bundle.ap)).toEqual(["real_ap_21a_1_31"]);
  });

  test("kind 变了（清单记 ap，条目归位成 rdl）→ 换前缀认领，并记 reclassified 边让 apply_review 搬过去", () => {
    const bundle = { ap: [], rdl: [{ id: "real_rdl_128b_1_28", text: body(SAME), questions: [28, 29, 30].map((n) => ({ stem: `q${n}`, q_number: n })) }] };
    const r = claimReferencedIds(bundle, { holds: [unit("reading/ap", "real_ap_128b_1_30")] });
    expect(bundle.rdl[0].id).toBe("real_rdl_128b_1_30");
    expect(r.edges).toEqual([{ from: "real_ap_128b_1_30", to: "real_rdl_128b_1_30", reason: "reclassified" }]);
  });

  test("靠上一版在线条目沿用到 id 的不参与认领（沿用优先），但会报警告", () => {
    const bundle = { ap: [withQs("real_ap_21a_1_31", body(SAME), [31, 33])], rdl: [] };
    const r = claimReferencedIds(bundle, { holds: [unit("reading/ap", "real_ap_21a_1_33")] }, { skipIds: ["real_ap_21a_1_31"] });
    expect(r.claimed).toEqual([]);
    expect(ids(bundle.ap)).toEqual(["real_ap_21a_1_31"]);
    expect(r.warnings.join("\n")).toContain("沿用优先");
  });

  test("一个条目命中多条整条下架：取题号最小的并警告，其余记边指到它（同一份材料）", () => {
    const bundle = { ap: [withQs("real_ap_46_2_11", body(SAME), [11, 13, 15])], rdl: [] };
    const r = claimReferencedIds(bundle, { holds: [unit("reading/ap", "real_ap_46_2_15"), unit("reading/ap", "real_ap_46_2_13")] });
    expect(ids(bundle.ap)).toEqual(["real_ap_46_2_13"]);
    expect(r.edges).toEqual([{ from: "real_ap_46_2_15", to: "real_ap_46_2_13", reason: "reclassified" }]);
    expect(r.warnings.join("\n")).toContain("命中多条整条下架");
  });

  test("同一个清单 id 只认领一次（两条都含同一题号时先到先得，后一条不动）", () => {
    const bundle = { ap: [withQs("real_ap_x_1_31", body(SAME), [31, 33]), withQs("real_ap_x_1_32", body(FAR), [32, 33])], rdl: [] };
    const r = claimReferencedIds(bundle, { holds: [unit("reading/ap", "real_ap_x_1_33")] });
    expect(r.claimed.map((c) => c.from)).toEqual(["real_ap_x_1_31"]);
    expect(ids(bundle.ap)).toEqual(["real_ap_x_1_33", "real_ap_x_1_32"]);
  });

  test("按 id 记的 patch 同样认领；整条下架优先于 patch，patch 的 id 记边指过去照样生效", () => {
    const onlyPatch = { ap: [withQs("real_ap_325_1_21", body(SAME), [21, 23])], rdl: [] };
    claimReferencedIds(onlyPatch, { patches: [{ file: "reading/ap", id: "real_ap_325_1_23", path: "passage", op: "replace", from: "x", to: "y" }] });
    expect(ids(onlyPatch.ap)).toEqual(["real_ap_325_1_23"]);

    const both = { ap: [withQs("real_ap_325_1_21", body(SAME), [21, 23, 25])], rdl: [] };
    const r = claimReferencedIds(both, {
      holds: [unit("reading/ap", "real_ap_325_1_25")],
      patches: [{ file: "reading/ap", id: "real_ap_325_1_23", path: "passage", op: "replace", from: "x", to: "y" }],
    });
    expect(ids(both.ap)).toEqual(["real_ap_325_1_25"]);
    expect(r.edges).toEqual([{ from: "real_ap_325_1_23", to: "real_ap_325_1_25", reason: "reclassified" }]);
  });

  test("认领的目标 id 已被别的在线条目占着 → 不认领（不许撞 id）", () => {
    const bundle = { ap: [withQs("real_ap_x_1_31", body(SAME), [31, 33]), withQs("real_ap_x_1_33", body(FAR), [34])], rdl: [] };
    const r = claimReferencedIds(bundle, { holds: [unit("reading/ap", "real_ap_x_1_33")] });
    expect(r.claimed).toEqual([]);
    expect(ids(bundle.ap)).toEqual(["real_ap_x_1_31", "real_ap_x_1_33"]);
  });

  test("认领之后，跨卷合并按 id 判「待下架」生效：被下架的那份不会当选代表（Opal 实例：完整版保住）", () => {
    const C = require("../scripts/realbank/consolidate_reading.js");
    const OPAL = "Opals form when silica-rich water seeps into cracks. Over time the water evaporates and leaves silica spheres.";
    const mk = (id, date, paras, qs) => ({ id, date, paragraphs: ["The Mysteries of Opal", ...paras], passage: ["The Mysteries of Opal", ...paras].join("\n\n"),
      questions: qs.map((n) => ({ question_type: "detail", stem: `Opal question ${n}?`, options: { A: `a${n}`, B: `b${n}`, C: `c${n}`, D: `d${n}` }, correct_answer: "A", q_number: n })) });
    // 21a 那份：段落更多、题更多（按老规则会当选代表），但清单判它材料中段缺失、整条下架；329 那份是在线的完整版
    const broken = mk("real_ap_21a_1_31", "2026-02-01", [OPAL, `${SHARED}.`, "Extra paragraph one.", "Extra paragraph two."], [31, 33, 34]);
    const whole = mk("real_ap_329_1_26", "2026-03-29", [OPAL, `${SHARED}.`], [26, 27]);
    const review = { holds: [unit("reading/ap", "real_ap_21a_1_33")] };
    const bundle = { ap: [broken, whole], rdl: [] };
    claimReferencedIds(bundle, review, { skipIds: ["real_ap_329_1_26"] });
    const r = C.consolidateReading(bundle, review);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].kept).toBe("real_ap_329_1_26");
    expect(r.clusters[0].dropped).toEqual(["real_ap_21a_1_33"]);
  });
});
