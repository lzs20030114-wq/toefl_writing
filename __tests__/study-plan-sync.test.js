/**
 * lib/studyPlan.js —— 保存/清空时把计划同步到 /api/study-plan(写库影子)。
 * 锁定:①保存会 POST 正确 body ②有 userCode 才发 ③fetch 失败不影响本地保存。
 */
import { saveStudyPlan, clearStudyPlan, loadStudyPlan } from "../lib/studyPlan";

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ ok: true }) }));
});
afterEach(() => {
  delete global.fetch;
  jest.restoreAllMocks();
});

test("saveStudyPlan 会 POST /api/study-plan 且 body 正确", () => {
  saveStudyPlan("abc123", { examDate: "2026-09-15", targetScore: 5, currentScore: 3.5 });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, opts] = global.fetch.mock.calls[0];
  expect(url).toBe("/api/study-plan");
  expect(opts.method).toBe("POST");
  const body = JSON.parse(opts.body);
  expect(body).toEqual({ code: "ABC123", examDate: "2026-09-15", targetScore: 5, currentScore: 3.5 });
  // 本地仍然写入(UI 真源不受网络影响)。
  expect(loadStudyPlan("abc123").examDate).toBe("2026-09-15");
});

test("游客(无 userCode)不发请求", () => {
  saveStudyPlan("", { examDate: "2026-09-15" });
  expect(global.fetch).not.toHaveBeenCalled();
});

test("clearStudyPlan 同步空值到云端", () => {
  saveStudyPlan("abc123", { examDate: "2026-09-15", targetScore: 5 });
  global.fetch.mockClear();
  clearStudyPlan("abc123");
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body).toEqual({ code: "ABC123", examDate: null, targetScore: null, currentScore: null });
});

test("fetch 抛错也不影响本地保存(fail-open)", () => {
  global.fetch = jest.fn(() => { throw new Error("network down"); });
  expect(() => saveStudyPlan("abc123", { examDate: "2026-09-15" })).not.toThrow();
  expect(loadStudyPlan("abc123").examDate).toBe("2026-09-15");
});
