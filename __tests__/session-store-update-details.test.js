// updateSessionDetails：给一条**已经保存过**的记录打补丁。
// 讲评(lesson)比评分晚 30 秒左右到，必须补进那条已落库的练习记录，
// 否则用户回历史页只看得到评分、看不到讲评。这里锁本地(localStorage)路径。
import { saveSess, loadHist, updateSessionDetails } from "../lib/sessionStore";

jest.mock("../lib/supabase", () => ({ isSupabaseConfigured: false }));
jest.mock("../lib/cloudSessionStore", () => ({
  loadSessionsCloud: jest.fn(async () => ({ sessions: [], error: null })),
  saveSessionCloud: jest.fn(async () => ({ error: null })),
  deleteSessionCloud: jest.fn(async () => ({ error: null })),
  clearAllSessionsCloud: jest.fn(async () => ({ error: null })),
  updateSessionDetailsCloud: jest.fn(async () => ({ error: null })),
}));

function saveOne({ rootId, attempt, feedback }) {
  saveSess({
    type: "discussion",
    score: 3.5,
    band: "Intermediate+",
    wordCount: 120,
    details: {
      promptId: "ad1",
      userText: "essay",
      feedback,
      practiceRootId: rootId,
      practiceAttempt: attempt,
    },
  });
}

describe("sessionStore.updateSessionDetails（本地路径）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("按 practiceRootId + practiceAttempt 找到那条记录并合并 lesson", async () => {
    saveOne({ rootId: "root-1", attempt: 1, feedback: { score: 3.5, summary: "s" } });

    const ok = await updateSessionDetails(
      { practiceRootId: "root-1", practiceAttempt: 1 },
      (details) => ({ ...details, feedback: { ...details.feedback, lesson: { ok: true } } })
    );

    expect(ok).toBe(true);
    const sessions = loadHist().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].details.feedback.lesson).toEqual({ ok: true });
    // 其余字段原样保留
    expect(sessions[0].details.feedback.summary).toBe("s");
    expect(sessions[0].details.userText).toBe("essay");
    expect(sessions[0].score).toBe(3.5);
  });

  test("同一题的不同 attempt 互不串台", async () => {
    saveOne({ rootId: "root-2", attempt: 1, feedback: { summary: "第一次" } });
    saveOne({ rootId: "root-2", attempt: 2, feedback: { summary: "第二次" } });

    await updateSessionDetails(
      { practiceRootId: "root-2", practiceAttempt: 2 },
      (details) => ({ ...details, feedback: { ...details.feedback, lesson: { tag: "second" } } })
    );

    const sessions = loadHist().sessions;
    expect(sessions[0].details.feedback.lesson).toBeUndefined();
    expect(sessions[1].details.feedback.lesson).toEqual({ tag: "second" });
  });

  test("找不到匹配项：返回 false，不动任何记录", async () => {
    saveOne({ rootId: "root-3", attempt: 1, feedback: { summary: "x" } });
    const before = JSON.stringify(loadHist());

    expect(await updateSessionDetails({ practiceRootId: "nope", practiceAttempt: 1 }, (d) => d)).toBe(false);
    expect(await updateSessionDetails({ practiceRootId: "root-3", practiceAttempt: 9 }, (d) => d)).toBe(false);
    expect(JSON.stringify(loadHist())).toBe(before);
  });

  test("参数非法 / patchFn 抛错：返回 false 而不是炸掉调用方", async () => {
    saveOne({ rootId: "root-4", attempt: 1, feedback: { summary: "x" } });

    expect(await updateSessionDetails(null, (d) => d)).toBe(false);
    expect(await updateSessionDetails({ practiceRootId: "" }, (d) => d)).toBe(false);
    expect(await updateSessionDetails({ practiceRootId: "root-4", practiceAttempt: 1 }, null)).toBe(false);

    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await updateSessionDetails({ practiceRootId: "root-4", practiceAttempt: 1 }, () => {
        throw new Error("boom");
      })
    ).toBe(false);
    // patchFn 返回非对象同样拒绝写入
    expect(
      await updateSessionDetails({ practiceRootId: "root-4", practiceAttempt: 1 }, () => "not an object")
    ).toBe(false);
    warn.mockRestore();

    expect(loadHist().sessions[0].details.feedback.summary).toBe("x");
  });

  test("只给 practiceRootId（不带 attempt）时取最后一条匹配", async () => {
    saveOne({ rootId: "root-5", attempt: 1, feedback: { summary: "a" } });
    saveOne({ rootId: "root-5", attempt: 2, feedback: { summary: "b" } });

    await updateSessionDetails({ practiceRootId: "root-5" }, (d) => ({ ...d, patched: true }));

    const sessions = loadHist().sessions;
    expect(sessions[0].details.patched).toBeUndefined();
    expect(sessions[1].details.patched).toBe(true);
  });
});
