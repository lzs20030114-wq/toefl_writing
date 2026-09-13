/**
 * lib/realBankAliases.js —— 真题阅读旧 id 别名（题库重建改名 / 归位后，用户按旧 id 记的东西不失效）。
 *
 * 账本 data/realBank/reading/id-aliases.json 由流水线生成；这里一律用自建 fixture（与真账本脱钩）。
 * 锁：①解析（链 / 环 / null 下线 / 跨题型）；②选题页「已练」跨题型、同题型合并都认；
 * ③按旧 id 找题接到新条目；④记录页覆盖率 / 题型按解析后的当前 id 计数；⑤缺账本 = 空账本。
 */
import {
  buildAliasIndex,
  collectRealReadingDoneIds,
  findRealReadingItem,
  realReadingTypeOfId,
  resolveRealReadingId,
  resolveRealReadingRef,
} from "../lib/realBankAliases";
import { buildRealBankCoverage, buildRealBankEntries, countRealBankSessions } from "../lib/realBankHistory";

const LEDGER = {
  generated_by: "fixture",
  generated: "2026-09-13",
  aliases: [
    // 放错进学术阅读的日常材料归位
    { from: "real_ap_310_1_25", to: "real_rdl_310_1_25", from_type: "ap", to_type: "rdl", reason: "reclassified" },
    // 跨卷同篇合并（同题型）
    { from: "real_ap_53_1_32", to: "real_ap_128a_1_27", from_type: "ap", to_type: "ap", reason: "consolidated" },
    // 链：两代改名没收敛（防御）
    { from: "real_ap_old_1_1", to: "real_ap_mid_1_1", from_type: "ap", to_type: "ap", reason: "consolidated" },
    { from: "real_ap_mid_1_1", to: "real_rdl_new_1_1", from_type: "ap", to_type: "rdl", reason: "reclassified" },
    // 已下线
    { from: "real_ap_gone_1_9", to: null, from_type: "ap", to_type: null, reason: "consolidated" },
    // 环（账本坏了）
    { from: "real_ap_loop_a", to: "real_ap_loop_b", from_type: "ap", to_type: "ap", reason: "x" },
    { from: "real_ap_loop_b", to: "real_ap_loop_a", from_type: "ap", to_type: "ap", reason: "x" },
    // 缺 to_type：按 to 的前缀认
    { from: "real_ap_notype_1_2", to: "real_rdl_notype_1_2", reason: "reclassified" },
  ],
};
const INDEX = buildAliasIndex(LEDGER);

describe("buildAliasIndex：逐条防御", () => {
  test("坏条目丢掉：非 real_ 前缀、to 非法、自指；同一个 from 以第一条为准", () => {
    const idx = buildAliasIndex({
      aliases: [
        { from: "ap_1", to: "real_ap_2" },
        { from: "real_ap_3", to: "rdl_3" },
        { from: "real_ap_4", to: "real_ap_4" },
        { from: "real_ap_5", to: "real_rdl_5", to_type: "rdl" },
        { from: "real_ap_5", to: "real_ap_99", to_type: "ap" },
        { from: "", to: "real_ap_6" },
        null,
      ],
    });
    expect([...idx.byFrom.keys()]).toEqual(["real_ap_5"]);
    expect(idx.byFrom.get("real_ap_5").to).toBe("real_rdl_5");
  });

  test("空 / 缺账本 → 空索引（不抛）", () => {
    expect(buildAliasIndex(null).byFrom.size).toBe(0);
    expect(buildAliasIndex({}).byFrom.size).toBe(0);
    expect(buildAliasIndex({ aliases: "nope" }).byFrom.size).toBe(0);
  });

  test("题型认前缀", () => {
    expect(realReadingTypeOfId("real_rdl_310_1_25")).toBe("rdl");
    expect(realReadingTypeOfId("real_ap_1")).toBe("ap");
    expect(realReadingTypeOfId("real_ctw_1")).toBe("ctw");
    expect(realReadingTypeOfId("real_lcr_1")).toBe("");
  });
});

describe("resolveRealReadingId", () => {
  test("不在账本里：原样返回（题型用记录的 / 前缀）", () => {
    expect(resolveRealReadingId("real_ap_128a_1_27", "ap", INDEX)).toEqual({ id: "real_ap_128a_1_27", type: "ap", aliased: false, retired: false, reason: "" });
    expect(resolveRealReadingId("real_rdl_x", "", INDEX).type).toBe("rdl");
  });

  test("归位：ap 旧 id → rdl 新 id + rdl 题型", () => {
    expect(resolveRealReadingId("real_ap_310_1_25", "ap", INDEX)).toMatchObject({ id: "real_rdl_310_1_25", type: "rdl", aliased: true, retired: false, reason: "reclassified" });
  });

  test("同篇合并：同题型换 id", () => {
    expect(resolveRealReadingId("real_ap_53_1_32", "ap", INDEX)).toMatchObject({ id: "real_ap_128a_1_27", type: "ap", aliased: true });
  });

  test("链：顺着走到底（old → mid → rdl new）", () => {
    expect(resolveRealReadingId("real_ap_old_1_1", "ap", INDEX)).toMatchObject({ id: "real_rdl_new_1_1", type: "rdl", aliased: true, retired: false });
  });

  test("to = null：已下线", () => {
    expect(resolveRealReadingId("real_ap_gone_1_9", "ap", INDEX)).toMatchObject({ id: null, aliased: true, retired: true });
  });

  test("环：当账本坏了，按没有别名处理（不死循环）", () => {
    expect(resolveRealReadingId("real_ap_loop_a", "ap", INDEX)).toMatchObject({ id: "real_ap_loop_a", aliased: false });
  });

  test("缺 to_type：按 to 的前缀认题型", () => {
    expect(resolveRealReadingId("real_ap_notype_1_2", "ap", INDEX)).toMatchObject({ id: "real_rdl_notype_1_2", type: "rdl" });
  });

  test("resolveRealReadingRef：非阅读题型原样放过（不把听力记录归位到阅读）", () => {
    expect(resolveRealReadingRef("real_ap_310_1_25", "lcr", INDEX)).toMatchObject({ id: "real_ap_310_1_25", type: "lcr", aliased: false });
    expect(resolveRealReadingRef("real_ap_310_1_25", "ap", INDEX)).toMatchObject({ id: "real_rdl_310_1_25", type: "rdl" });
  });
});

describe("collectRealReadingDoneIds：选题页「已练」", () => {
  const doneLoader = (map) => (t) => new Set(map[t] || []);

  test("跨题型：旧 ap id 记在 AP 的 key 里 → 日常阅读列表的新条目算已练", () => {
    const done = collectRealReadingDoneIds("rdl", doneLoader({ ap: ["real_ap_310_1_25"], rdl: ["real_rdl_other"] }), INDEX);
    expect(done.has("real_rdl_310_1_25")).toBe(true);
    // 自身 key 里原有的保留
    expect(done.has("real_rdl_other")).toBe(true);
  });

  test("旧 id 记在当前题型自己的 key 里也算", () => {
    const done = collectRealReadingDoneIds("rdl", doneLoader({ rdl: ["real_ap_310_1_25"] }), INDEX);
    expect(done.has("real_rdl_310_1_25")).toBe(true);
  });

  test("同题型合并：做过副本 → 代表条目算已练", () => {
    const done = collectRealReadingDoneIds("ap", doneLoader({ ap: ["real_ap_53_1_32"] }), INDEX);
    expect(done.has("real_ap_128a_1_27")).toBe(true);
  });

  test("链也认；下线的不凭空加条目；归位走的不会在原题型列表里亮", () => {
    const loader = doneLoader({ ap: ["real_ap_old_1_1", "real_ap_gone_1_9", "real_ap_310_1_25"] });
    const rdl = collectRealReadingDoneIds("rdl", loader, INDEX);
    expect(rdl.has("real_rdl_new_1_1")).toBe(true);
    const ap = collectRealReadingDoneIds("ap", loader, INDEX);
    expect(ap.has("real_rdl_310_1_25")).toBe(false);
    expect([...ap].filter((id) => id.startsWith("real_rdl_"))).toEqual([]);
    expect([...rdl].some((id) => id === null)).toBe(false);
  });

  test("没做过就不亮；loader 抛错 / 返回数组都兜得住", () => {
    expect(collectRealReadingDoneIds("rdl", doneLoader({}), INDEX).size).toBe(0);
    expect(collectRealReadingDoneIds("rdl", () => { throw new Error("storage"); }, INDEX).size).toBe(0);
    expect(collectRealReadingDoneIds("rdl", (t) => (t === "ap" ? ["real_ap_310_1_25"] : []), INDEX).has("real_rdl_310_1_25")).toBe(true);
  });
});

describe("findRealReadingItem：按（旧）id 找题", () => {
  const BANK = {
    ap: [{ id: "real_ap_128a_1_27" }],
    rdl: [{ id: "real_rdl_310_1_25" }, { id: "real_rdl_new_1_1" }],
    ctw: [],
  };
  const itemsFor = (t) => BANK[t] || [];

  test("精确命中当前题型", () => {
    expect(findRealReadingItem("real_ap_128a_1_27", "ap", itemsFor, INDEX)).toEqual({ item: BANK.ap[0], type: "ap", aliased: false });
  });

  test("同题型旧 id → 新条目", () => {
    expect(findRealReadingItem("real_ap_53_1_32", "ap", itemsFor, INDEX)).toEqual({ item: BANK.ap[0], type: "ap", aliased: true });
  });

  test("跨题型旧 id → 去新题型找，并告诉调用方按新题型渲染", () => {
    expect(findRealReadingItem("real_ap_310_1_25", "ap", itemsFor, INDEX)).toEqual({ item: BANK.rdl[0], type: "rdl", aliased: true });
    expect(findRealReadingItem("real_ap_old_1_1", "ap", itemsFor, INDEX)).toMatchObject({ type: "rdl", item: BANK.rdl[1] });
  });

  test("下线 / 查无此题 → null（页面给逃生口）", () => {
    expect(findRealReadingItem("real_ap_gone_1_9", "ap", itemsFor, INDEX)).toBeNull();
    expect(findRealReadingItem("real_ap_nope", "ap", itemsFor, INDEX)).toBeNull();
    expect(findRealReadingItem("", "ap", itemsFor, INDEX)).toBeNull();
  });
});

describe("记录页覆盖率 / 题型：按解析后的当前 id 计数", () => {
  const reading = (id, subtype, itemId, date) => ({
    id, type: "reading", mode: "standard", date, correct: 1, total: 2,
    details: { subtype, itemId, results: [{ isCorrect: true }, { isCorrect: false }], passage: "x", questions: [] },
  });
  const SESSIONS = [
    reading(1, "ap", "real_ap_310_1_25", "2026-09-01T10:00:00.000Z"), // 归位 → rdl
    reading(2, "ap", "real_ap_53_1_32", "2026-09-02T10:00:00.000Z"), // 合并副本
    reading(3, "ap", "real_ap_128a_1_27", "2026-09-03T10:00:00.000Z"), // 代表本身（与 2 是同一篇）
    reading(4, "ap", "real_ap_gone_1_9", "2026-09-04T10:00:00.000Z"), // 已下线
    reading(5, "rdl", "real_rdl_310_1_25", "2026-09-05T10:00:00.000Z"), // 新 id 又做了一次（与 1 同一篇）
    {
      id: 6, type: "listening", mode: "standard", date: "2026-09-06T10:00:00.000Z", correct: 1, total: 1,
      details: { subtype: "lcr", itemIds: ["real_ap_310_1_25"], real: true, results: [{ isCorrect: true }] },
    },
  ];
  const resolveItemRef = (id, sub) => resolveRealReadingRef(id, sub, INDEX);

  test("entry.subtype = 当前题型（ap 记录归位到 rdl），recordedSubtype 保留原值；非阅读记录不动", () => {
    const entries = buildRealBankEntries(SESSIONS, { resolveItemRef });
    const bySrc = Object.fromEntries(entries.map((e) => [e.sourceIndex, e]));
    expect(bySrc[1]).toMatchObject({ subtype: "rdl", recordedSubtype: "ap", itemIds: ["real_rdl_310_1_25"] });
    expect(bySrc[2]).toMatchObject({ subtype: "ap", itemIds: ["real_ap_128a_1_27"] });
    expect(bySrc[4]).toMatchObject({ subtype: "ap", itemIds: [] });
    expect(bySrc[6]).toMatchObject({ subtype: "lcr", itemIds: ["real_ap_310_1_25"] });
    // 记录一条都不少（下线的题记录照样在列表里，只是不计覆盖）
    expect(entries).toHaveLength(6);
    // 最新一次 = 时间最新那条，题型已解析
    expect(entries[0].sourceIndex).toBe(6);
    expect(entries[1]).toMatchObject({ sourceIndex: 5, subtype: "rdl" });
  });

  test("覆盖率：同一篇旧 id / 新 id 只算一篇，归位的算进 rdl，下线的不计", () => {
    const coverage = buildRealBankCoverage(buildRealBankEntries(SESSIONS, { resolveItemRef }), { ap: 99, rdl: 107, lcr: 419 });
    const by = Object.fromEntries(coverage.map((c) => [c.subtype, c]));
    expect(by.rdl.done).toBe(1); // 1 与 5 是同一篇
    expect(by.ap.done).toBe(1); // 2 与 3 是同一篇；4 已下线
    expect(by.lcr.done).toBe(1);
  });

  test("不注入 resolver 时与从前完全一致（按记录里的 id / 题型）", () => {
    const entries = buildRealBankEntries(SESSIONS);
    expect(entries.every((e) => !("itemIds" in e) && !("recordedSubtype" in e))).toBe(true);
    const by = Object.fromEntries(buildRealBankCoverage(entries, {}).map((c) => [c.subtype, c]));
    expect(by.ap.done).toBe(4);
    expect(by.rdl.done).toBe(1);
    expect(countRealBankSessions(SESSIONS)).toBe(6);
  });

  test("resolver 抛错不连累记录页：该 id 原样计数", () => {
    const entries = buildRealBankEntries([SESSIONS[0]], { resolveItemRef: () => { throw new Error("boom"); } });
    expect(entries[0]).toMatchObject({ subtype: "ap", itemIds: ["real_ap_310_1_25"] });
  });
});

describe("默认账本：读 data/realBank/reading/id-aliases.json", () => {
  const LEDGER_PATH = "../data/realBank/reading/id-aliases.json";

  test("账本在 → 模块默认索引就用它（路径与流水线契约一致）", () => {
    jest.isolateModules(() => {
      jest.doMock(LEDGER_PATH, () => ({ aliases: [{ from: "real_ap_310_1_25", to: "real_rdl_310_1_25", from_type: "ap", to_type: "rdl", reason: "reclassified" }] }), { virtual: true });
      const mod = require("../lib/realBankAliases");
      expect(mod.resolveRealReadingId("real_ap_310_1_25", "ap")).toMatchObject({ id: "real_rdl_310_1_25", type: "rdl" });
      expect(mod.collectRealReadingDoneIds("rdl", (t) => (t === "ap" ? ["real_ap_310_1_25"] : [])).has("real_rdl_310_1_25")).toBe(true);
    });
  });

  test("账本还没生成（require 抛错）→ 按空账本处理，不抛", () => {
    jest.isolateModules(() => {
      jest.doMock(LEDGER_PATH, () => { throw new Error("Cannot find module"); }, { virtual: true });
      const mod = require("../lib/realBankAliases");
      expect(mod.REAL_READING_ALIAS_INDEX.byFrom.size).toBe(0);
      expect(mod.resolveRealReadingId("real_ap_310_1_25", "ap")).toMatchObject({ id: "real_ap_310_1_25", aliased: false });
    });
  });
});
