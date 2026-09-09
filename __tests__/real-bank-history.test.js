/**
 * lib/realBankHistory.js —— 真题练习记录的纯函数层。
 * 锁三件事：①辨认口径与后台真题统计（lib/admin/realSession）一致；②12 题型的统一得分 /
 * 条目 id 口径；③覆盖率 / 科目聚合不把非真题、模考记录混进来。
 */
import {
  buildRealBankCoverage,
  buildRealBankEntries,
  buildRealBankSubjectStats,
  countRealBankSessions,
  isRealBankSession,
  realScoreColor,
  realSessionItemIds,
  realSessionScore,
  realSessionSubtype,
  REAL_SUBTYPE_META,
  REAL_SUBTYPE_ORDER,
} from "../lib/realBankHistory";
import { isRealSession } from "../lib/admin/realSession";

const realReading = {
  id: 11, type: "reading", mode: "standard", date: "2026-09-02T10:00:00.000Z", correct: 8, total: 10, band: 5,
  details: { subtype: "ctw", itemId: "real_ctw_1", topic: "Campus housing", results: [], passage: "", blanks: [] },
};
const liveReading = {
  id: 12, type: "reading", mode: "standard", date: "2026-09-02T11:00:00.000Z", correct: 3, total: 10,
  details: { subtype: "ctw", itemId: "ctw-live-1", topic: "Live item", results: [] },
};
const realListening = {
  id: 13, type: "listening", mode: "practice", date: "2026-09-03T10:00:00.000Z", correct: 1, total: 1,
  details: { subtype: "lcr", itemIds: ["real_lcr_1"], real: true, results: [{ isCorrect: true }], items: [{ id: "real_lcr_1", speaker: "Hi" }] },
};
const realSpeaking = {
  id: 14, type: "speaking", mode: "standard", date: "2026-09-04T10:00:00.000Z",
  details: { subtype: "repeat", setId: "real_rep_1", real: true, averageScore: 4.2, attempted: 3, total: 3, items: [] },
};
const realDiscussion = {
  id: 15, type: "discussion", mode: "standard", date: "2026-09-05T10:00:00.000Z", score: 4, band: "B2",
  details: { promptId: "real_ad_1", promptSummary: "Should cities…", promptData: { id: "real_ad_1", tier: "recalled" }, feedback: {} },
};
const failedEmail = {
  id: 16, type: "email", mode: "standard", date: "2026-09-05T11:00:00.000Z", score: null,
  details: { promptId: "real_em_1", scoringFailed: true, promptData: { id: "real_em_1", tier: "official" } },
};
const realBs = {
  id: 17, type: "bs", mode: "challenge", date: "2026-09-06T10:00:00.000Z", correct: 9, total: 10,
  details: [
    { qid: "real_bs_1", prompt: "a", isCorrect: true },
    { qid: "real_bs_2", prompt: "b", isCorrect: false },
    { qid: "real_bs_1", prompt: "a", isCorrect: true },
  ],
};
const liveBs = { id: 18, type: "bs", date: "2026-09-06T11:00:00.000Z", correct: 5, total: 10, details: [{ qid: "123", isCorrect: true }] };
const mock = { id: 19, type: "mock", date: "2026-09-07T10:00:00.000Z", band: 4.5, details: { mockSessionId: "m1", tasks: [] } };
const adaptiveMock = { id: 20, type: "reading", mode: "mock", date: "2026-09-07T11:00:00.000Z", details: { subtype: "mock", m1: {}, m2: {} } };

const ALL = [realReading, liveReading, realListening, realSpeaking, realDiscussion, failedEmail, realBs, liveBs, mock, adaptiveMock];

describe("realBankHistory：辨认与题型", () => {
  test("isRealBankSession 与后台 isRealSession 是同一把尺子", () => {
    for (const s of ALL) expect(isRealBankSession(s)).toBe(isRealSession(s));
  });

  test("realSessionSubtype：写作三 type 直接是题型；阅读 / 听力 / 口语取 details.subtype；模考 / 未知返回空", () => {
    expect(realSessionSubtype(realReading)).toBe("ctw");
    expect(realSessionSubtype(realListening)).toBe("lcr");
    expect(realSessionSubtype(realSpeaking)).toBe("repeat");
    expect(realSessionSubtype(realDiscussion)).toBe("discussion");
    expect(realSessionSubtype(realBs)).toBe("bs");
    expect(realSessionSubtype(mock)).toBe("");
    expect(realSessionSubtype(adaptiveMock)).toBe("");
    // subtype 与 type 科目对不上（脏数据）也不认
    expect(realSessionSubtype({ type: "reading", details: { subtype: "lcr" } })).toBe("");
  });

  test("REAL_SUBTYPE_ORDER 覆盖全部 12 题型且每个都有元数据", () => {
    expect(REAL_SUBTYPE_ORDER).toHaveLength(12);
    REAL_SUBTYPE_ORDER.forEach((t) => expect(REAL_SUBTYPE_META[t]).toBeTruthy());
  });
});

describe("realBankHistory：条目 id 与得分", () => {
  test("realSessionItemIds：造句一卷多个 qid（不去重，由覆盖率去重）；其余一条一个 id；非 real_ 前缀不算", () => {
    expect(realSessionItemIds(realBs)).toEqual(["real_bs_1", "real_bs_2", "real_bs_1"]);
    expect(realSessionItemIds(realReading)).toEqual(["real_ctw_1"]);
    expect(realSessionItemIds(realListening)).toEqual(["real_lcr_1"]);
    expect(realSessionItemIds(realSpeaking)).toEqual(["real_rep_1"]);
    expect(realSessionItemIds(realDiscussion)).toEqual(["real_ad_1"]);
    expect(realSessionItemIds(liveReading)).toEqual([]);
    expect(realSessionItemIds(liveBs)).toEqual([]);
  });

  test("realSessionScore：客观题 正确/总数；写作 分/5；口语 平均分/5；评分失败标「未评分」", () => {
    expect(realSessionScore(realReading)).toEqual({ label: "8/10", pct: 80, kind: "objective" });
    expect(realSessionScore(realBs)).toEqual({ label: "9/10", pct: 90, kind: "objective" });
    expect(realSessionScore(realDiscussion)).toEqual({ label: "4/5", pct: 80, kind: "writing" });
    expect(realSessionScore(failedEmail)).toEqual({ label: "未评分", pct: null, kind: "writing" });
    expect(realSessionScore(realSpeaking)).toEqual({ label: "4.2/5", pct: 84, kind: "speaking" });
    // 口语没平均分 → 退回「录了几句」
    expect(realSessionScore({ type: "speaking", details: { subtype: "repeat", attempted: 2, total: 3 } }))
      .toEqual({ label: "2/3", pct: null, kind: "speaking" });
  });

  test("realScoreColor 三档阈值", () => {
    expect(realScoreColor(90)).toBe("#059669");
    expect(realScoreColor(65)).toBe("#D97706");
    expect(realScoreColor(10)).toBe("#E11D48");
    expect(realScoreColor(null, "#fallback")).toBe("#fallback");
  });
});

describe("realBankHistory：聚合", () => {
  test("buildRealBankEntries 只留真题记录，按时间倒序，带 sourceIndex（云端 id 优先）", () => {
    const entries = buildRealBankEntries(ALL);
    expect(entries.map((e) => e.sourceIndex)).toEqual([17, 16, 15, 14, 13, 11]);
    expect(entries.map((e) => e.subtype)).toEqual(["bs", "email", "discussion", "repeat", "lcr", "ctw"]);
    expect(countRealBankSessions(ALL)).toBe(6);
    // 没有 id 的本地记录退回数组下标
    const local = buildRealBankEntries([{ ...realReading, id: undefined }, liveReading]);
    expect(local).toHaveLength(1);
    expect(local[0].sourceIndex).toBe(0);
  });

  test("buildRealBankCoverage：按题型去重条目数 / 题库总量", () => {
    const entries = buildRealBankEntries(ALL);
    const cov = buildRealBankCoverage(entries, { bs: 4, ctw: 10, lcr: 100 });
    const by = Object.fromEntries(cov.map((c) => [c.subtype, c]));
    expect(by.bs).toEqual({ subtype: "bs", subject: "writing", done: 2, total: 4, pct: 50 });
    expect(by.ctw).toEqual({ subtype: "ctw", subject: "reading", done: 1, total: 10, pct: 10 });
    expect(by.lcr.done).toBe(1);
    expect(by.lcr.pct).toBe(1);
    // 没给总量的题型 total=0、pct=null，但已练数仍在
    expect(by.discussion).toEqual({ subtype: "discussion", subject: "writing", done: 1, total: 0, pct: null });
    expect(by.lat).toEqual({ subtype: "lat", subject: "listening", done: 0, total: 0, pct: null });
    expect(cov.map((c) => c.subtype)).toEqual(REAL_SUBTYPE_ORDER);
  });

  test("buildRealBankSubjectStats：四科条数 + 平均得分率（未评分不计入平均）", () => {
    const stats = buildRealBankSubjectStats(buildRealBankEntries(ALL));
    const by = Object.fromEntries(stats.map((s) => [s.subject, s]));
    // 写作：bs 90 + discussion 80，email 未评分不计 → 平均 85，条数 3
    expect(by.writing).toEqual({ subject: "writing", count: 3, avgPct: 85 });
    expect(by.reading).toEqual({ subject: "reading", count: 1, avgPct: 80 });
    expect(by.listening).toEqual({ subject: "listening", count: 1, avgPct: 100 });
    expect(by.speaking).toEqual({ subject: "speaking", count: 1, avgPct: 84 });
  });

  test("空输入 / 非数组不抛", () => {
    expect(buildRealBankEntries(null)).toEqual([]);
    expect(countRealBankSessions(undefined)).toBe(0);
    expect(buildRealBankCoverage([], {}).every((c) => c.done === 0)).toBe(true);
  });
});
