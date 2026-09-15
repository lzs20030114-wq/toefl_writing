/**
 * 造句跨卷重复别名（scripts/realbank/bs_aliases.js）。
 *
 * 为什么要锁：这份账本是「132 道题到底算丢了还是躺在库里」的唯一凭据 —— 少一条，
 * assemble_sets 那一槽就空着、丢题账本把它算成缺题、前端那一卷就少一道题。
 */
const {
  WRITING_ALIAS_PURPOSE, BS_ALIAS_REASON, bsAnswerKey,
  bsAliasEntries, bsDupSetEdges, bsGroundTruthEdges, bsIdSuffix, bsIdForSlug,
} = require("../scripts/realbank/bs_aliases.js");
const GT = require("../data/realExam2026/writing/buildSentence.json");
const ALIASES = require("../data/realBank/writing/id-aliases.json");
const BS = require("../data/realBank/writing/bs.json");

describe("bsAliasEntries", () => {
  test("补齐契约字段、按 from 升序、同一个 from 只留第一条", () => {
    const out = bsAliasEntries([
      { from: "bs_41_03", to: "bs_321_02", fromSource: "4.1新托福真题", fromDate: "2026-04-01" },
      { from: "bs_41_03", to: "bs_999_01", fromSource: "4.1新托福真题", fromDate: "2026-04-01" }, // 后来的不覆盖
      { from: "bs_21c_01", to: "bs_34_05", reason: BS_ALIAS_REASON.DUP_SET, fromSource: "2.1新托福真题C卷", fromDate: "2026-02-01" },
    ]);
    expect(out.map((a) => a.from)).toEqual(["bs_21c_01", "bs_41_03"]);
    expect(out[1]).toEqual({
      from: "bs_41_03", to: "bs_321_02", from_type: "bs", to_type: "bs",
      reason: BS_ALIAS_REASON.DUP_ANSWER, from_source: "4.1新托福真题", from_date: "2026-04-01",
    });
    expect(out[0].reason).toBe(BS_ALIAS_REASON.DUP_SET);
  });

  test("自指边 / 缺 from / 缺 to 一律丢掉（别名指向自己会让 indexItems 绕圈）", () => {
    expect(bsAliasEntries([
      { from: "bs_41_03", to: "bs_41_03" },
      { from: "", to: "bs_34_01" },
      { from: "bs_41_04", to: "" },
    ])).toEqual([]);
  });

  test("from_source / from_date 缺了就记 null —— 下游据此知道这条别名定位不了卷", () => {
    const [a] = bsAliasEntries([{ from: "bs_41_03", to: "bs_321_02" }]);
    expect(a.from_source).toBeNull();
    expect(a.from_date).toBeNull();
  });
});

describe("bsDupSetEdges（整份写作源文件与更早一套相同的卷）", () => {
  const items = [
    { id: "bs_315_03", source: "3.15新托福真题" },
    { id: "bs_315_10", source: "3.15新托福真题" },
    { id: "bs_34_01", source: "3.4新托福真题" },
  ];
  test("按题号逐题对应，补位宽度照抄保留方的 id", () => {
    const edges = bsDupSetEdges({
      dupSets: [{ setname: "3.20新托福真题", kept: "3.15新托福真题" }],
      items, slugOf: () => "320", dateOf: () => "2026-03-20",
    });
    expect(edges.map((e) => `${e.from}→${e.to}`)).toEqual(["bs_320_03→bs_315_03", "bs_320_10→bs_315_10"]);
    expect(edges.every((e) => e.reason === BS_ALIAS_REASON.DUP_SET && e.fromDate === "2026-03-20")).toBe(true);
  });

  test("保留方一条题都没有（整科被扣下）→ 不造别名", () => {
    expect(bsDupSetEdges({
      dupSets: [{ setname: "rf0902", kept: "rf9999" }], items, slugOf: () => "rf0902", dateOf: () => null,
    })).toEqual([]);
  });

  test("id 题号解析", () => {
    expect(bsIdSuffix("bs_225_03")).toBe("03");
    expect(bsIdSuffix("bs_rf0610_1")).toBe("1");
    expect(bsIdSuffix("bs_broken")).toBeNull();
    expect(bsIdForSlug("bs_225_03", "rf0610")).toBe("bs_rf0610_03");
    expect(bsIdForSlug("bs_broken", "320")).toBeNull();
  });
});

describe("bsGroundTruthEdges（真题 ground truth 对照）", () => {
  const items = [
    { id: "bs_34_01", source: "3.4新托福真题", answer: "I missed the class this morning." },
    { id: "bs_34_02", source: "3.4新托福真题", answer: "Can you send me the notes?" },
    { id: "bs_223_02", source: "2.23新托福真题", answer: "The workshop was canceled." },
  ];
  const args = { items, slugOf: (s) => ({ "2.23新托福真题": "223", "3.4新托福真题": "34" }[s] || null), dateOf: () => null };

  test("GT 说这一卷考过、库里又有这个答案句 → 记别名，题号取 GT 的 n", () => {
    const edges = bsGroundTruthEdges({
      ...args,
      gtItems: [{ source: "2.23新托福真题", date: "2026-02-23", n: 7, target: "i missed the class this morning" }],
    });
    expect(edges).toEqual([{
      from: "bs_223_07", to: "bs_34_01", reason: BS_ALIAS_REASON.GT_SAME_ITEM,
      fromSource: "2.23新托福真题", fromDate: "2026-02-23",
    }]);
  });

  test("这一卷已经有同一道题（原生或别名）→ 不重复记", () => {
    expect(bsGroundTruthEdges({
      ...args,
      gtItems: [{ source: "2.23新托福真题", n: 2, target: "The workshop was canceled" }],
    })).toEqual([]);
    expect(bsGroundTruthEdges({
      ...args,
      aliases: [{ from: "bs_223_05", to: "bs_34_02", from_source: "2.23新托福真题" }],
      gtItems: [{ source: "2.23新托福真题", n: 6, target: "can you send me the notes?" }],
    })).toEqual([]);
  });

  test("库里根本没有这个答案句 → 不记（那是真缺题，别名补不了）", () => {
    expect(bsGroundTruthEdges({
      ...args,
      gtItems: [{ source: "2.23新托福真题", n: 3, target: "a sentence nobody has" }],
    })).toEqual([]);
  });

  test("题号已被这一卷的现有 id 占了 → 跳过，不抢号也不另编号（两来源说法不一，留给人工对原卷）", () => {
    expect(bsGroundTruthEdges({
      ...args,
      gtItems: [{ source: "2.23新托福真题", n: 2, target: "i missed the class this morning" }],
    })).toEqual([]);
  });

  test("卷不在源卷清单里（slugOf 返回 null）→ 不给它造槽位", () => {
    expect(bsGroundTruthEdges({
      ...args, slugOf: () => null,
      gtItems: [{ source: "9.9某卷", n: 1, target: "i missed the class this morning" }],
    })).toEqual([]);
  });
});

describe("落库的账本（data/realBank/writing/id-aliases.json）", () => {
  const bsAliases = (ALIASES.aliases || []).filter((a) => a.from_type === "bs");
  const byId = new Map(BS.items.map((it) => [it.id, it]));

  test("每条都指向库里活着的题，from 不与库里已有 id 撞车", () => {
    expect(bsAliases.length).toBeGreaterThan(100);
    const bad = bsAliases.filter((a) => !byId.has(a.to) || byId.has(a.from));
    expect(bad.map((a) => a.from)).toEqual([]);
  });

  test("from_source / from_date 一条不缺（缺了 assemble_sets 会把别名整条丢掉、槽位照样空着）", () => {
    expect(bsAliases.filter((a) => !a.from_source || !a.from_date).map((a) => a.from)).toEqual([]);
  });

  test("from 的 slug 与 from_source 是同一卷，且不是自指", () => {
    const slugOf = (id) => (/^bs_(.+)_\d+$/.exec(id) || [])[1];
    const bySource = new Map();
    for (const a of bsAliases) {
      const slug = slugOf(a.from);
      const prev = bySource.get(a.from_source);
      if (prev) expect(slug).toBe(prev);            // 同一卷的别名 slug 必须一致
      else bySource.set(a.from_source, slug);
      expect(a.from).not.toBe(a.to);
      expect(slugOf(a.to)).not.toBe(slug);          // 保留方来自别的卷（跨卷重复才记别名）
    }
  });

  test("GT 对照那批：每条都能在 ground truth 里查到「这一卷考过这个答案句」", () => {
    const gtBySet = new Map();
    for (const g of GT.items || []) {
      const k = bsAnswerKey(g.target);
      if (!gtBySet.has(g.source)) gtBySet.set(g.source, new Set());
      gtBySet.get(g.source).add(k);
    }
    const fromGt = bsAliases.filter((a) => a.reason === BS_ALIAS_REASON.GT_SAME_ITEM);
    expect(fromGt.length).toBeGreaterThan(0);
    const unsupported = fromGt.filter((a) => {
      const kept = byId.get(a.to);
      return !kept || !(gtBySet.get(a.from_source) || new Set()).has(bsAnswerKey(kept.answer));
    });
    expect(unsupported.map((a) => a.from)).toEqual([]);
  });

  test("邮件 / 讨论的别名没被造句这一批挤掉，_purpose 与生成器一致", () => {
    expect((ALIASES.aliases || []).filter((a) => a.from_type !== "bs").length).toBeGreaterThan(0);
    expect(ALIASES._purpose).toBe(WRITING_ALIAS_PURPOSE);
  });
});
