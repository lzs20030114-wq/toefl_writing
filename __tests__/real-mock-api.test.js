jest.mock("../lib/supabaseAdmin", () => ({ isSupabaseAdminConfigured: true, supabaseAdmin: { from: jest.fn() } }));
jest.mock("../lib/rateLimit", () => ({ createRateLimiter: () => ({ isLimited: () => false }), getIp: () => "127.0.0.1" }));
jest.mock("../lib/ai/routeGuards", () => ({ isOriginAllowed: () => true }));
jest.mock("../lib/realMockExam/repository", () => ({ prepareAttempt: jest.fn(), getAttempt: jest.fn(), transitionAttempt: jest.fn() }));

import { POST } from "../app/api/real-mock-exam/route";
import * as admin from "../lib/supabaseAdmin";
import * as repo from "../lib/realMockExam/repository";

const attemptId = "11111111-1111-4111-8111-111111111111";
const item = { id: "real_ctw_a", taskType: "ctw", realMockKeys: ["id:real_ctw_a", "material:a"] };
const next = { id: "real_ap_b", taskType: "ap", realMockKeys: ["id:real_ap_b", "material:b"] };
const other = { id: "real_ap_c", taskType: "ap", realMockKeys: ["id:real_ap_c", "material:c"] };
const active = { id: attemptId, status: "active", route: "upper", lease_expires_at: "2099-01-01", snapshot: { m1Items: [item], m2ByPath: { upper: [next], lower: [other] } } };
const post = (body) => POST({ headers: { get: () => null }, json: async () => ({ userCode: "ABC123", ...body }) });

beforeAll(() => {
  global.Response = { json: (body, options = {}) => ({ status: options.status || 200, json: async () => body }) };
});
beforeEach(() => {
  jest.clearAllMocks();
  admin.supabaseAdmin.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { code: "ABC123", tier: "pro", status: "active" } }) }) }) }));
  repo.getAttempt.mockResolvedValue(active);
  repo.transitionAttempt.mockResolvedValue({ status: "ok" });
  repo.prepareAttempt.mockResolvedValue({ ok: true, paper: { attemptId } });
});

test("Pro expiry and disabled account fail before preparing", async () => {
  admin.supabaseAdmin.from.mockImplementationOnce(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tier: "pro", tier_expires_at: "2000-01-01", status: "active" } }) }) }) }));
  expect((await (await post({ section: "reading" })).json()).code).toBe("PRO_REQUIRED");
  admin.supabaseAdmin.from.mockImplementationOnce(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tier: "pro", status: "suspended" } }) }) }) }));
  expect((await (await post({ section: "reading" })).json()).code).toBe("INVALID_USER");
  expect(repo.prepareAttempt).not.toHaveBeenCalled();
});

test("unconfigured admin fails closed", async () => {
  jest.resetModules();
  jest.doMock("../lib/supabaseAdmin", () => ({ isSupabaseAdminConfigured: false, supabaseAdmin: null }));
  const { POST: offlinePost } = require("../app/api/real-mock-exam/route");
  const result = await offlinePost({ headers: { get: () => null }, json: async () => ({ userCode: "ABC123", section: "reading" }) });
  expect((await result.json()).code).toBe("DATABASE_UNAVAILABLE");
});

test("attempt ownership and stored snapshot constrain seen markers", async () => {
  repo.getAttempt.mockResolvedValueOnce(null);
  expect((await (await post({ action: "seen", attemptId, items: [item] })).json()).code).toBe("ATTEMPT_NOT_FOUND");
  expect((await (await post({ action: "seen", attemptId, items: [{ id: "invented", taskType: "ctw", realMockKey: "material:a" }] })).json()).code).toBe("INVALID_ITEMS");
  expect((await (await post({ action: "seen", attemptId, items: [other] })).json()).code).toBe("INVALID_ITEMS");
  expect(repo.transitionAttempt).not.toHaveBeenCalled();
  expect((await (await post({ action: "seen", attemptId, items: [next] })).json()).ok).toBe(true);
  expect(repo.transitionAttempt).toHaveBeenCalledWith("ABC123", attemptId, "seen", next.realMockKeys, null, false);
});

test("finish response can be retried after previous finish", async () => {
  repo.getAttempt.mockResolvedValueOnce({ ...active, status: "finished" });
  const result = await post({ action: "finish", attemptId });
  expect(result.status).toBe(200);
  expect((await result.json()).ok).toBe(true);
});

// 拒绝的状态迁移以前原样回 RPC 的英文状态字（"finished" / "expired" / "invalid-route"），客户端直接显示给用户。
test.each([
  ["finished", 409, "ATTEMPT_FINISHED", "这份试卷已结束（可能已在其他设备或页面重新开始）。"],
  ["expired", 409, "ATTEMPT_EXPIRED", "这份试卷超过 2 小时没有作答，保留已过期。"],
  ["missing", 404, "ATTEMPT_NOT_FOUND", "找不到这份试卷。"],
  ["invalid-route", 409, "INVALID_ROUTE", "路线与服务器记录不一致，请刷新页面后重试。"],
  ["invalid-key", 400, "INVALID_ITEMS", "题目不属于这份试卷。"],
  ["invalid-action", 409, "TRANSITION_REJECTED", "试卷状态更新失败，请重试。"],
  [undefined, 409, "TRANSITION_REJECTED", "试卷状态更新失败，请重试。"],
])("rejected transition %s → %s %s with Chinese copy", async (status, http, code, error) => {
  repo.transitionAttempt.mockResolvedValueOnce(status ? { status } : null);
  const result = await post({ action: "seen", attemptId, items: [next] });
  expect(result.status).toBe(http);
  const body = await result.json();
  expect(body).toMatchObject({ ok: false, code, error });
  expect(body.error).not.toMatch(/[A-Za-z]/);
});

test("pre-checks on a finished or lapsed attempt use the same wording as the RPC mapping", async () => {
  repo.getAttempt.mockResolvedValueOnce({ ...active, status: "finished" });
  const finished = await post({ action: "seen", attemptId, items: [next] });
  expect(finished.status).toBe(409);
  expect(await finished.json()).toMatchObject({ code: "ATTEMPT_FINISHED", error: "这份试卷已结束（可能已在其他设备或页面重新开始）。" });
  repo.getAttempt.mockResolvedValueOnce({ ...active, lease_expires_at: "2000-01-01T00:00:00.000Z" });
  const expired = await post({ action: "route", attemptId, path: "upper" });
  expect(expired.status).toBe(409);
  expect(await expired.json()).toMatchObject({ code: "ATTEMPT_EXPIRED", error: "这份试卷超过 2 小时没有作答，保留已过期。" });
  // A lapsed lease never blocks finish: it only releases still-unseen reservations.
  repo.getAttempt.mockResolvedValueOnce({ ...active, lease_expires_at: "2000-01-01T00:00:00.000Z" });
  expect((await (await post({ action: "finish", attemptId })).json()).ok).toBe(true);
  expect(repo.transitionAttempt).toHaveBeenCalledTimes(1);
});
