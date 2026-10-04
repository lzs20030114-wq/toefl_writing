import { describeRealMockDeficits, describeRealMockError } from "../lib/realMockExam/messages";
import {
  RealMockError,
  finishRealMockExamReliably,
  flushPendingFinishes,
  prepareRealMockExam,
  rememberPendingFinish,
} from "../lib/realMockExam/client";

const PENDING_KEY = "toefl-real-mock-pending-finish";
const ok = (body = {}) => ({ ok: true, json: async () => ({ ok: true, ...body }) });
const fail = (status, body) => ({ ok: false, status, json: async () => ({ ok: false, ...body }) });
const pending = () => JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
const bodies = () => global.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("toefl-user-code", "ABC123");
  global.fetch = jest.fn();
});

describe("describeRealMockDeficits", () => {
  test("merges the per-route duplicates and speaks in user units, not planner codes", () => {
    const parts = describeRealMockDeficits([
      { path: "upper", taskType: "ctw", need: 3, available: 2 },
      { path: "lower", taskType: "ctw", need: 3, available: 2 },
      { path: "lower", taskType: "rdl2", need: 3, available: 2 },
    ]);
    expect(parts).toEqual([
      "填词还差 1 篇（一套需要 3 篇，你没做过的只剩 2 篇）",
      "两题日常阅读还差 1 篇（一套需要 3 篇，你没做过的只剩 2 篇）",
    ]);
    expect(parts.join("")).not.toMatch(/rdl2|ctw/);
  });

  test("explains a pure material conflict", () => {
    expect(describeRealMockDeficits([{ path: "both", taskType: "material-conflict", need: 1, available: 0, gap: 1 }]))
      .toEqual(["剩下的题目之间内容有重叠，凑不出互不重复的一整套"]);
  });
});

describe("describeRealMockError", () => {
  test("exhaustion is not retryable", () => {
    const info = describeRealMockError(new RealMockError("x", { code: "REAL_MOCK_EXHAUSTED", deficits: [{ taskType: "ap", need: 2, available: 1 }] }));
    expect(info).toMatchObject({ kind: "exhausted", canRetry: false });
    expect(info.message).toContain("学术阅读还差 1 篇");
  });

  test("an active attempt needs an explicit release and carries its id", () => {
    const info = describeRealMockError(new RealMockError("x", { code: "ACTIVE_ATTEMPT", activeAttemptId: "a1" }));
    expect(info).toMatchObject({ kind: "active-attempt", canRetry: false, activeAttemptId: "a1" });
  });

  test.each(["ATTEMPT_FINISHED", "ATTEMPT_EXPIRED", "ATTEMPT_NOT_FOUND"])("%s means the paper is dead", (code) => {
    expect(describeRealMockError(new RealMockError("这份试卷已结束。", { code }))).toMatchObject({ kind: "dead-attempt", canRetry: false });
  });

  test("network and server hiccups stay retryable", () => {
    expect(describeRealMockError(new RealMockError("无法连接", { code: "NETWORK_ERROR" }))).toMatchObject({ kind: "transient", canRetry: true });
    expect(describeRealMockError(new Error("boom"))).toMatchObject({ kind: "transient", canRetry: true, message: "boom" });
  });
});

describe("finish after the record is saved", () => {
  const paper = { attemptId: "11111111-1111-4111-8111-111111111111", userCode: "ABC123", section: "reading" };

  test("a finish that lands clears the pending marker", async () => {
    global.fetch.mockResolvedValue(ok({ status: "ok" }));
    await expect(finishRealMockExamReliably(paper, { delays: [0] })).resolves.toBe(true);
    expect(pending()).toEqual([]);
  });

  test("a finish that keeps failing is remembered, never thrown", async () => {
    global.fetch.mockResolvedValue(fail(503, { code: "REAL_MOCK_ERROR", error: "down" }));
    await expect(finishRealMockExamReliably(paper, { delays: [0, 0] })).resolves.toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(pending()).toEqual([expect.objectContaining({ attemptId: paper.attemptId, userCode: "ABC123", section: "reading" })]);
  });

  test("the next prepare finishes the remembered paper first", async () => {
    rememberPendingFinish(paper);
    global.fetch
      .mockResolvedValueOnce(ok({ status: "ok" }))
      .mockResolvedValueOnce(ok({ paper: { attemptId: "new" } }));
    await expect(prepareRealMockExam("reading")).resolves.toEqual({ attemptId: "new" });
    expect(bodies().map((b) => b.action)).toEqual(["finish", "prepare"]);
    expect(bodies()[0].attemptId).toBe(paper.attemptId);
    expect(pending()).toEqual([]);
  });

  test("a failed flush never blocks prepare, and another account's paper is left alone", async () => {
    rememberPendingFinish(paper);
    rememberPendingFinish({ ...paper, attemptId: "22222222-2222-4222-8222-222222222222", userCode: "OTHER1" });
    global.fetch
      .mockResolvedValueOnce(fail(503, { code: "REAL_MOCK_ERROR" }))
      .mockResolvedValueOnce(ok({ paper: { attemptId: "new" } }));
    await expect(prepareRealMockExam("reading")).resolves.toEqual({ attemptId: "new" });
    expect(bodies().filter((b) => b.action === "finish").map((b) => b.attemptId)).toEqual([paper.attemptId]);
    expect(pending().map((x) => x.attemptId).sort()).toEqual([paper.attemptId, "22222222-2222-4222-8222-222222222222"].sort());
  });

  test("an unfinishable id is dropped instead of retried forever", async () => {
    rememberPendingFinish(paper);
    global.fetch.mockResolvedValue(fail(404, { code: "ATTEMPT_NOT_FOUND" }));
    await flushPendingFinishes();
    expect(pending()).toEqual([]);
  });
});
