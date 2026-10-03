/**
 * lib/realBankRescore.js + sessionStore.patchSession —— 真题「重试评分」。
 * 锁：①只有「写作 + 无反馈 + 题与原文都在」才可重试；②成功后 score / band / feedback 一起补回
 * 同一条记录并清掉失败标记；③评分失败抛中文错误且不改记录；④本地存储路径按下标回写。
 */
const evaluate = jest.fn();
jest.mock("../lib/ai/writingEval", () => ({ evaluateWritingResponse: (...a) => evaluate(...a) }));
jest.mock("../lib/supabase", () => ({ isSupabaseConfigured: false, supabase: null }));

import { applyRescore, canRescoreSession, rescoreWritingEntry } from "../lib/realBankRescore";
import { loadHist, patchSession } from "../lib/sessionStore";

const failed = {
  type: "email", score: null, band: null, mode: "standard", date: "2026-09-28T20:48:00.000Z",
  details: {
    promptId: "real_em_1", promptData: { id: "real_em_1", to: "Ms. Carter", goals: ["a", "b", "c"] },
    userText: "Dear Ms. Carter, the heater is broken.", feedback: null, scoringFailed: true, scoringError: "AI 响应超时，请重试",
  },
};
const fb = { score: 4, band: "4", summary: "ok", annotationSegments: [], comparison: { modelEssay: "", points: [] } };

beforeEach(() => {
  evaluate.mockReset();
  localStorage.clear();
});

describe("canRescoreSession", () => {
  test("写作 + 无反馈 + 题与作答都在 → 可重试", () => {
    expect(canRescoreSession(failed)).toBe(true);
    expect(canRescoreSession({ ...failed, type: "discussion" })).toBe(true);
  });
  test("已有反馈 / 缺作答 / 缺题 / 非写作 → 不可", () => {
    expect(canRescoreSession({ ...failed, details: { ...failed.details, feedback: fb } })).toBe(false);
    expect(canRescoreSession({ ...failed, details: { ...failed.details, userText: "  " } })).toBe(false);
    expect(canRescoreSession({ ...failed, details: { ...failed.details, promptData: null } })).toBe(false);
    expect(canRescoreSession({ type: "reading", details: {} })).toBe(false);
    expect(canRescoreSession(null)).toBe(false);
  });
});

describe("applyRescore", () => {
  test("补回分数 / 档位 / 反馈，清掉失败标记，其余字段原样", () => {
    const next = applyRescore(failed, fb, new Date("2026-10-03T12:00:00.000Z"));
    expect(next).toMatchObject({ score: 4, band: "4", type: "email", date: failed.date });
    expect(next.details).toMatchObject({ feedback: fb, scoringFailed: false, rescoredAt: "2026-10-03T12:00:00.000Z", userText: failed.details.userText });
    expect(next.details).not.toHaveProperty("scoringError");
    expect(failed.details.scoringFailed).toBe(true); // 不改入参
  });
});

describe("rescoreWritingEntry（本地存储路径）", () => {
  function seed() {
    localStorage.setItem("toefl-hist", JSON.stringify({ sessions: [{ type: "reading", details: {} }, failed] }));
  }

  test("成功：按下标把新分数与反馈写回同一条", async () => {
    seed();
    evaluate.mockResolvedValue(fb);
    const out = await rescoreWritingEntry({ session: failed, sourceIndex: 1 });
    expect(evaluate).toHaveBeenCalledWith("email", failed.details.promptData, failed.details.userText, "zh");
    expect(out).toEqual({ feedback: fb, saved: true });
    const saved = loadHist().sessions;
    expect(saved).toHaveLength(2);
    expect(saved[1].score).toBe(4);
    expect(saved[1].details.feedback.score).toBe(4);
    expect(saved[1].details.scoringFailed).toBe(false);
    expect(saved[0].type).toBe("reading");
  });

  test("评分失败：抛中文错误，记录不动", async () => {
    seed();
    evaluate.mockRejectedValue(new Error("API timeout"));
    await expect(rescoreWritingEntry({ session: failed, sourceIndex: 1 })).rejects.toThrow("AI 响应超时，请重试");
    expect(loadHist().sessions[1].score).toBeNull();
  });

  test("评分结果没有有效分数：当失败处理", async () => {
    seed();
    evaluate.mockResolvedValue({ summary: "x" });
    await expect(rescoreWritingEntry({ session: failed, sourceIndex: 1 })).rejects.toThrow("评分结果无效");
  });

  test("记录已不在了：评分照出，saved=false", async () => {
    localStorage.setItem("toefl-hist", JSON.stringify({ sessions: [] }));
    evaluate.mockResolvedValue(fb);
    expect(await rescoreWritingEntry({ session: failed, sourceIndex: 1 })).toEqual({ feedback: fb, saved: false });
  });

  test("不可重试的记录直接拒绝，不调评分", async () => {
    await expect(rescoreWritingEntry({ session: { ...failed, details: { ...failed.details, feedback: fb } }, sourceIndex: 0 })).rejects.toThrow("无法重新评分");
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe("patchSession", () => {
  test("patchFn 返回 null / 抛错都不写，返回 false", async () => {
    localStorage.setItem("toefl-hist", JSON.stringify({ sessions: [failed] }));
    expect(await patchSession(0, () => null)).toBe(false);
    expect(await patchSession(0, () => { throw new Error("x"); })).toBe(false);
    expect(await patchSession(5, (s) => s)).toBe(false);
    expect(loadHist().sessions[0].score).toBeNull();
  });
});
