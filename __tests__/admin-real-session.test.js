/**
 * @jest-environment node
 *
 * 后台「真题板块」：真题练习记录的判定 + 全站聚合（纯函数）。
 * 判定口径要与 app/real-bank/page.js 各 saveReal*Session / WritingTask / useBuildSentenceSession
 * 落库的 details 形状一一对应——这里每种题型各造一条真题 + 一条普通题做对照。
 */
import {
  REAL_SESSION_SELECT,
  isRealSession,
  isRealSessionRow,
  projectRealFields,
  realItemIdOf,
} from "../lib/admin/realSession";
import { aggregateRealBank } from "../lib/admin/realBankStats";

// 完整 details（activity 路由拉整段 details 时的形状）
const FULL_ROWS = {
  readingReal: { type: "reading", details: { subtype: "ap", itemId: "real_ap_511_1_26", results: [] } },
  readingLive: { type: "reading", details: { subtype: "ap", itemId: "ap_0042", results: [] } },
  listeningReal: { type: "listening", details: { subtype: "lcr", itemIds: ["real_lcr_01"], real: true } },
  listeningLive: { type: "listening", details: { subtype: "lcr", itemIds: ["lcr_01"] } },
  speakingReal: { type: "speaking", details: { subtype: "repeat", setId: "real_rp_3", real: true } },
  speakingLive: { type: "speaking", details: { subtype: "repeat", setId: "rp_3" } },
  discussionReal: { type: "discussion", details: { promptId: "real_ad12", userText: "x" } },
  discussionLive: { type: "discussion", details: { promptId: "ad12", userText: "x" } },
  emailReal: { type: "email", details: { promptId: "real_tpo3_1" } },
  bsReal: { type: "bs", details: [{ qid: "real_bs_t1_01", prompt: "p", isCorrect: true }] },
  bsLive: { type: "bs", details: [{ qid: "bs_0001", prompt: "p", isCorrect: true }] },
  bsLegacy: { type: "bs", details: [{ prompt: "p", isCorrect: true }] },
  mock: { type: "mock", details: { tasks: [] } },
  empty: { type: "reading", details: null },
};

describe("isRealSession (完整 details)", () => {
  test.each([
    ["readingReal", true], ["readingLive", false],
    ["listeningReal", true], ["listeningLive", false],
    ["speakingReal", true], ["speakingLive", false],
    ["discussionReal", true], ["discussionLive", false],
    ["emailReal", true],
    ["bsReal", true], ["bsLive", false], ["bsLegacy", false],
    ["mock", false], ["empty", false],
  ])("%s → %s", (key, expected) => {
    expect(isRealSession(FULL_ROWS[key])).toBe(expected);
  });

  test("projectRealFields 与 PostgREST 投影字段名一致", () => {
    const projected = projectRealFields(FULL_ROWS.bsReal);
    expect(projected.bsQid).toBe("real_bs_t1_01");
    for (const alias of ["subtype", "real", "itemId", "promptId", "setId", "itemIds", "bsQid"]) {
      expect(REAL_SESSION_SELECT).toContain(`${alias}:details`);
    }
  });
});

describe("isRealSessionRow (投影行，details->>real 是字符串)", () => {
  test("listening 投影出 real:'true' 判为真题", () => {
    expect(isRealSessionRow({ type: "listening", real: "true", itemIds: ["real_lc_1"] })).toBe(true);
  });
  test("reading 只看 itemId 前缀（阅读真题没写 real 标记）", () => {
    expect(isRealSessionRow({ type: "reading", real: null, itemId: "real_ctw_2" })).toBe(true);
    expect(isRealSessionRow({ type: "reading", real: null, itemId: "ctw_2" })).toBe(false);
  });
  test("realItemIdOf 取各题型的条目 id", () => {
    expect(realItemIdOf({ type: "listening", itemIds: ["real_lc_1"] })).toBe("real_lc_1");
    expect(realItemIdOf({ type: "speaking", setId: "real_iv_2" })).toBe("real_iv_2");
    expect(realItemIdOf({ type: "email", promptId: "real_tpo5_2" })).toBe("real_tpo5_2");
    expect(realItemIdOf({ type: "bs", bsQid: "real_bs_1" })).toBe("real_bs_1");
    expect(realItemIdOf({ type: "reading", itemId: "ap_1" })).toBe("");
  });
});

describe("aggregateRealBank", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  const rows = [
    { user_code: "A", type: "reading", date: "2026-09-07T01:00:00Z", score: { correct: 4, total: 5 }, subtype: "ap", itemId: "real_ap_1" },
    { user_code: "A", type: "reading", date: "2026-09-06T01:00:00Z", score: { correct: 5, total: 5 }, subtype: "ap", itemId: "real_ap_1" },
    { user_code: "B", type: "listening", date: "2026-09-06T02:00:00Z", score: { correct: 1, total: 1 }, subtype: "lcr", real: "true", itemIds: ["real_lcr_9"] },
    { user_code: "B", type: "discussion", date: "2026-09-05T02:00:00Z", score: { score: 4 }, promptId: "real_ad3" },
    { user_code: "C", type: "discussion", date: "2026-09-05T03:00:00Z", score: { score: 3 }, promptId: "real_ad3" },
    // 非真题：计入 allSessions / allUsers，不进真题统计
    { user_code: "C", type: "reading", date: "2026-09-05T04:00:00Z", score: { correct: 0, total: 5 }, subtype: "ap", itemId: "ap_77" },
    { user_code: "D", type: "bs", date: "2026-09-04T04:00:00Z", score: { correct: 9, total: 10 }, bsQid: "bs_1" },
    { user_code: "D", type: "mock", date: "2026-09-04T05:00:00Z", score: { tasks: [] } },
  ];

  test("总量 / 人数 / 占比 / 客观题正确率", () => {
    const out = aggregateRealBank(rows, { days: 7, now });
    expect(out.allSessions).toBe(8);
    expect(out.allUsers).toBe(4);
    expect(out.realSessions).toBe(5);
    expect(out.realUsers).toBe(3);
    expect(out.realSharePct).toBe(63); // 5/8
    expect(out.userSharePct).toBe(75); // 3/4
    expect(out.accuracyPct).toBe(91); // (4+5+1)/(5+5+1) = 10/11
  });

  test("分题型：12 种固定顺序，客观题给正确率、写作给均分", () => {
    const out = aggregateRealBank(rows, { days: 7, now });
    expect(out.subtypes).toHaveLength(12);
    const ap = out.subtypes.find((s) => s.subtype === "ap");
    expect(ap).toMatchObject({ subject: "reading", sessions: 2, users: 1, correct: 9, total: 10, accuracyPct: 90 });
    const disc = out.subtypes.find((s) => s.subtype === "discussion");
    expect(disc).toMatchObject({ sessions: 2, users: 2, accuracyPct: null, avgScore: 3.5 });
    const ctw = out.subtypes.find((s) => s.subtype === "ctw");
    expect(ctw).toMatchObject({ sessions: 0, users: 0, accuracyPct: null });
  });

  test("Top 真题按场次排序，daily 补齐空日", () => {
    const out = aggregateRealBank(rows, { days: 7, now });
    // 场次并列时人数多的靠前（real_ad3 两人 > real_ap_1 一人）
    expect(out.topItems[0]).toMatchObject({ id: "real_ad3", sessions: 2, users: 2 });
    expect(out.topItems.map((t) => t.id)).toEqual(["real_ad3", "real_ap_1", "real_lcr_9"]);
    expect(out.daily).toHaveLength(7);
    expect(out.daily[6]).toEqual({ date: "2026-09-07", count: 1 });
    expect(out.daily[5]).toEqual({ date: "2026-09-06", count: 2 });
    expect(out.daily[0]).toEqual({ date: "2026-09-01", count: 0 });
  });

  test("全量（days=0）只列有数据的日子", () => {
    const out = aggregateRealBank(rows, { days: 0, now });
    expect(out.daily.map((d) => d.date)).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
  });

  test("空表不崩", () => {
    const out = aggregateRealBank([], { days: 7, now });
    expect(out.realSessions).toBe(0);
    expect(out.realSharePct).toBeNull();
    expect(out.accuracyPct).toBeNull();
    expect(out.topItems).toEqual([]);
  });
});
