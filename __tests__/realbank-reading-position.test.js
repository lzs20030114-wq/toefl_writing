/**
 * 真题阅读「日常 / 学术按考卷位置归位」的锁（scripts/realbank/reading_position.mjs）。
 *
 * 老判据「材料 ≥160 词就算学术」把 14 篇长篇网页/通知/帖子塞进了 ap.json。新判据看考卷题号带，
 * 但**只在归属确定时才改**：M1 26-30 在 A 型是日常、在 B 型是学术，版式判不准就一律不动 ——
 * 改错一篇学术文章（它就再也不会出现在学术阅读列表里）比放着一篇长通知更糟。
 */
const { decideReadingKinds } = require("../scripts/realbank/reading_position.mjs");

const g = (key, module, qs, kind, genre = "passage") => ({ key, module, qs, kind, genre });
const byKey = (res) => Object.fromEntries(res.map((r) => [r.key, r]));

describe("题号带与版式无关的：直接归位", () => {
  test("M1 21-25 一律日常阅读（ap → rdl）", () => {
    const r = byKey(decideReadingKinds([g("a", 1, [23, 24, 25], "ap", "website")], { slug: "411" }));
    expect(r.a).toMatchObject({ kind: "rdl", changed: true, why: "m1_band_21_25" });
  });

  test("M1 31-35 一律学术（rdl → ap，反方向同样查）", () => {
    const r = byKey(decideReadingKinds([g("a", 1, [33, 34, 35], "rdl")], { slug: "428" }));
    expect(r.a).toMatchObject({ kind: "ap", changed: true, why: "m1_band_31_35" });
  });

  test("M2 11-15 一律学术（M2 没有日常阅读）", () => {
    const r = byKey(decideReadingKinds([g("a", 2, [13, 14], "rdl")], { slug: "32a" }));
    expect(r.a).toMatchObject({ kind: "ap", changed: true, why: "m2_band_11_15" });
  });

  test("跨 25/26 的组只有 A 型放得下 → 日常阅读", () => {
    const r = byKey(decideReadingKinds([g("a", 1, [25, 26, 27], "ap", "website")], { slug: "310" }));
    expect(r.a).toMatchObject({ kind: "rdl", why: "fits_form_A_only" });
  });

  test("rf 卷的百位题号先归一（125 → 25）", () => {
    const r = byKey(decideReadingKinds([g("a", 1, [123, 124, 125], "ap", "notice")], { slug: "rf0610" }));
    expect(r.a).toMatchObject({ kind: "rdl", why: "m1_band_21_25" });
  });

  test("本来就对的不动（changed=false）", () => {
    const r = byKey(decideReadingKinds([g("a", 1, [31, 32, 33, 34, 35], "ap"), g("b", 1, [21, 22], "rdl")], { slug: "53" }));
    expect(r.a.changed).toBe(false);
    expect(r.b.changed).toBe(false);
  });
});

describe("M1 26-30：看版式，没有结构证据就不动", () => {
  test("A 证据（同卷有跨 25/26 的组）→ 26-30 的组归日常", () => {
    const res = decideReadingKinds([
      g("straddle", 1, [25, 26, 27], "rdl", "notice"),
      g("late", 1, [28, 29, 30], "ap", "email"),
      g("ap31", 1, [31, 32, 33, 34, 35], "ap"),
    ], { slug: "311" });
    expect(byKey(res).late).toMatchObject({ kind: "rdl", changed: true, why: "m1_26_30_form_A" });
  });

  test("B 证据（同卷 26-30 有一簇 ≥4 题的学术文章）→ 那一簇归学术", () => {
    const res = decideReadingKinds([
      g("rdl21", 1, [21, 22], "rdl", "notice"),
      g("rdl23", 1, [23, 24, 25], "rdl", "email"),
      g("cluster", 1, [26, 27, 28, 29], "rdl"),     // 老判据误标成 rdl 的学术簇
    ], { slug: "325" });
    expect(byKey(res).cluster).toMatchObject({ kind: "ap", changed: true, why: "m1_26_30_form_B" });
  });

  test("两种证据都没有：日常体裁 + ≤3 题才归日常", () => {
    const res = byKey(decideReadingKinds([g("a", 1, [28, 29], "ap", "notice")], { slug: "323" }));
    expect(res.a).toMatchObject({ kind: "rdl", why: "m1_26_30_daily_genre" });
  });

  test("两种证据都没有、体裁也不是日常体裁 → 判不准，不动", () => {
    const res = byKey(decideReadingKinds([g("a", 1, [26, 27, 28], "ap", "passage")], { slug: "330" }));
    expect(res.a).toMatchObject({ kind: "ap", changed: false, why: "form_undetermined" });
  });

  test("A、B 证据同时出现（数据自相矛盾）→ 不动", () => {
    const res = byKey(decideReadingKinds([
      g("straddle", 1, [25, 26], "rdl", "notice"),
      g("cluster", 1, [26, 27, 28, 29, 30], "ap"),
    ], { slug: "x1" }));
    expect(res.cluster.changed).toBe(false);
  });

  test("A 证据成立时，同带里别的 ap 也一并归日常（归位后的整卷版式自洽）", () => {
    const res = byKey(decideReadingKinds([
      g("straddle", 1, [25, 26], "rdl", "notice"),
      g("ap27", 1, [27], "ap", "passage"),
      g("notice", 1, [28, 29, 30], "ap", "notice"),
    ], { slug: "x2" }));
    expect(res.ap27).toMatchObject({ kind: "rdl", why: "m1_26_30_form_A" });
    expect(res.notice).toMatchObject({ kind: "rdl", why: "m1_26_30_form_A" });
  });

  test("与 assemble_sets 的版式判定打架就撤回（不许 build 与装卷各说各话）", () => {
    // 结构上有 A 证据，但还有一组从 26 起步、跨到 31 的 ap（跨槽位，本条不动它）——
    // assemble_sets 按 positionType 会把它当 26 起步的学术簇、判 B 型。这时把 28-30 的通知归成 rdl
    // 会与装卷的 B 型判定冲突 → 撤回。
    const res = byKey(decideReadingKinds([
      g("straddle", 1, [25, 26], "rdl", "notice"),
      g("span", 1, [26, 31], "ap", "passage"),
      g("notice", 1, [28, 29, 30], "ap", "notice"),
    ], { slug: "x5" }));
    expect(res.span).toMatchObject({ changed: false, why: "spans_slots" });
    expect(res.notice).toMatchObject({ kind: "ap", changed: false, why: "form_conflict_with_assemble" });
  });
});

describe("认不出位置的：不动", () => {
  test("拼盘卷 rp* 没有卷面题号", () => {
    const res = byKey(decideReadingKinds([g("a", 2001, [200101, 200102], "ap", "notice")], { slug: "rp0704" }));
    expect(res.a).toMatchObject({ changed: false, why: "pool_set" });
  });

  test("跨 30/31 的组（跨槽位）", () => {
    const res = byKey(decideReadingKinds([g("a", 1, [30, 31], "rdl")], { slug: "x3" }));
    expect(res.a).toMatchObject({ changed: false, why: "spans_slots" });
  });

  test("没有题号", () => {
    const res = byKey(decideReadingKinds([g("a", 1, [], "ap")], { slug: "x4" }));
    expect(res.a).toMatchObject({ changed: false, why: "unanchored" });
  });
});
