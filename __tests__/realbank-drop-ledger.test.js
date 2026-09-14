/**
 * 落库丢弃账本（scripts/realbank/drop_ledger.js）。
 *
 * 为什么要锁：build_bank 的丢弃计数以前只 console.log 到终端，跑完即散 —— 「这一轮丢了多少题、丢在哪一关」
 * 事后无从查证（2026-09-14 追 AP 那 36 题就卡在这里）。这本账一旦记错（重复记、题数口径错、原因码乱起名），
 * 丢题账本会把「落库丢弃」和「管线丢题」分错桶，下一轮补题又会朝错的方向使劲。
 */
const { DROP_CODES, makeDropRecorder, summarizeDrops, dropLedgerPayload, indexDropsForAttribution } =
  require("../scripts/realbank/drop_ledger.js");

describe("记账器", () => {
  test("原因码必须是登记过的 build_bank stats 键名，乱起名直接抛错", () => {
    const rec = makeDropRecorder();
    expect(() => rec.drop({ set: "3.21新托福真题", code: "optionsBroken", n: 1 })).toThrow(/未登记的原因码/);
    expect(() => rec.drop({ set: "3.21新托福真题", code: "droppedBadOptions", n: 1 })).not.toThrow();
  });

  test("逐题丢弃带题数；整科丢弃题数不可知记 null，科目按原因码默认", () => {
    const rec = makeDropRecorder();
    rec.drop({ set: "3.21新托福真题", slug: "321", type: "ap", module: 1, q: 33, n: 1, code: "droppedDisagree", detail: "盲审选 B，答案页 C" });
    rec.drop({ set: "2.23新托福真题", slug: "223", code: "droppedHeld", detail: "section_no_stems" });
    expect(rec.rows[0]).toMatchObject({ section: "reading", type: "ap", q: 33, n: 1, scope: "question", code: "droppedDisagree" });
    expect(rec.rows[1]).toMatchObject({ section: "reading", n: null, scope: "section", code: "droppedHeld" });
  });

  test("每个登记的原因码都有中文说明、scope 与科目", () => {
    for (const [code, spec] of Object.entries(DROP_CODES)) {
      expect([code, Boolean(spec.label), ["question", "unit", "section"].includes(spec.scope), Boolean(spec.section)])
        .toEqual([code, true, true, true]);
    }
  });
});

describe("汇总与落盘形状", () => {
  const rec = makeDropRecorder();
  rec.drop({ set: "A", slug: "a", type: "ap", q: 31, n: 1, code: "droppedDisagree" });
  rec.drop({ set: "A", slug: "a", type: "ap", q: 32, n: 1, code: "droppedBadOptions" });
  rec.drop({ set: "B", slug: "b", type: "ctw", module: 1, q: 1, n: 10, code: "buildFailed" });
  rec.drop({ set: "C", slug: "c", code: "wDroppedHeld" });

  test("题数只加有 n 的行，整科丢弃另计套·科数", () => {
    const s = summarizeDrops(rec.rows);
    expect(s.rows).toBe(4);
    expect(s.questions).toBe(12);
    expect(s.sections).toBe(1);
    expect(s.byCode.droppedDisagree).toMatchObject({ rows: 1, questions: 1 });
    expect(s.byCode.wDroppedHeld).toMatchObject({ rows: 1, questions: 0, sections: 1 });
    expect(s.byType.ap).toMatchObject({ questions: 2, byCode: { droppedDisagree: 1, droppedBadOptions: 1 } });
  });

  test("落盘形状与 loss-ledger.json 同风格：_generated / _purpose / summary / rows，并标明是不是 --dry 跑出来的", () => {
    const p = dropLedgerPayload(rec.rows, { generated: "2026-09-14", dry: true });
    expect(Object.keys(p)).toEqual(expect.arrayContaining(["_generated", "_generated_by", "_purpose", "_codes", "summary", "rows"]));
    expect(p._dry_run).toBe(true);
    expect(p.rows).toHaveLength(4);
    expect(p._codes.droppedInsert).toMatch(/■/);
  });
});

describe("给丢题账本的额度索引", () => {
  test("逐题 / 整组按 题型|slug 累加题数；整科丢弃按 科目|slug 记原因码（不设上限）", () => {
    const rec = makeDropRecorder();
    rec.drop({ set: "A", slug: "321", type: "ap", n: 1, code: "droppedDisagree" });
    rec.drop({ set: "A", slug: "321", type: "ap", n: 1, code: "droppedNoAudit" });
    rec.drop({ set: "A", slug: "321", type: "ctw", n: 10, code: "buildFailed" });
    rec.drop({ set: "B", slug: "223", section: "writing", code: "wDroppedHeld" });
    const idx = indexDropsForAttribution(rec.rows);
    expect(idx.byTypeSlug.get("ap|321")).toBe(2);
    expect(idx.byTypeSlug.get("ctw|321")).toBe(10);
    expect(idx.codesByTypeSlug.get("ap|321")).toEqual({ droppedDisagree: 1, droppedNoAudit: 1 });
    expect(idx.sectionSlug.get("writing|223")).toEqual(["wDroppedHeld"]);
  });

  test("没有 slug 的行不进索引（认不出是哪套卷就不许认领任何缺口）", () => {
    const rec = makeDropRecorder();
    rec.drop({ set: "?", type: "ap", n: 3, code: "droppedDisagree" });
    const idx = indexDropsForAttribution(rec.rows);
    expect(idx.byTypeSlug.size).toBe(0);
  });
});
