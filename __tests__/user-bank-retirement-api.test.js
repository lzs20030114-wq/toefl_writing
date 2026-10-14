/** @jest-environment node */
const mockFrom = jest.fn();
const mockRemove = jest.fn();
const mockLimiter = { isLimited: jest.fn(() => false) };
jest.mock("../lib/supabaseAdmin", () => ({
  isSupabaseAdminConfigured: true,
  supabaseAdmin: { from: mockFrom, storage: { from: () => ({ remove: mockRemove }) } },
}));
jest.mock("../lib/rateLimit", () => ({
  createRateLimiter: () => mockLimiter, getIp: () => "127.0.0.1",
}));
// Retired routes must not even load the gate or paid/generation providers.
jest.mock("../lib/userBankAuth", () => { throw new Error("Unexpected user-bank gate load"); });
jest.mock("../lib/ai/deepseekHttp", () => { throw new Error("Unexpected DeepSeek load"); });
jest.mock("../lib/ai/qwenVision", () => { throw new Error("Unexpected Qwen load"); });
jest.mock("../lib/tts/edgeTts", () => { throw new Error("Unexpected TTS load"); });
jest.mock("../lib/tts/storage", () => { throw new Error("Unexpected audio storage load"); });
const bank = require("../app/api/user-bank/route");
const routes = [
  ["save", bank],
  ["extract", require("../app/api/user-bank/extract/route")],
  ["extract-image", require("../app/api/user-bank/extract-image/route")],
  ["verify", require("../app/api/user-bank/verify/route")],
  ["render-audio", require("../app/api/user-bank/render-audio/route")],
];
beforeEach(() => jest.clearAllMocks());
test.each(routes)("%s rejects old clients before parsing or touching services", async (_, route) => {
  const request = {
    json: jest.fn(() => { throw new Error("Unexpected JSON parsing"); }),
    formData: jest.fn(() => { throw new Error("Unexpected image parsing"); }),
  };
  const response = await route.POST(request);
  expect(response.status).toBe(410);
  expect(await response.json()).toEqual({
    ok: false, code: "USER_BANK_RETIRED",
    error: "个人题库导入功能已下线，已有题目和练习记录仍可使用。",
  });
  expect(request.json).not.toHaveBeenCalled();
  expect(request.formData).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockLimiter.isLimited).not.toHaveBeenCalled();
});

test("GET continues returning existing questions scoped to their owner and type", async () => {
  const rows = [{ id: 1, item_id: "usr_ABC123_1_0", type: "email", data: { scenario: "Existing question" } }];
  const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue({ data: rows, error: null }) };
  mockFrom.mockReturnValue(query);
  const response = await bank.GET(new Request("https://app.test/api/user-bank?code=ABC123&type=email"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, items: rows });
  expect(query.eq).toHaveBeenCalledWith("user_code", "ABC123");
  expect(query.eq).toHaveBeenCalledWith("type", "email");
  expect(mockRemove).not.toHaveBeenCalled();
});

test("DELETE remains an explicit owner-scoped operation", async () => {
  const query = { delete: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue({ data: [{ id: 1, data: {} }], error: null }) };
  mockFrom.mockReturnValue(query);
  const response = await bank.DELETE(new Request("https://app.test/api/user-bank?code=ABC123&id=1", { method: "DELETE" }));
  expect(await response.json()).toEqual({ ok: true, removed: 1 });
  expect(query.eq).toHaveBeenCalledWith("user_code", "ABC123");
  expect(query.eq).toHaveBeenCalledWith("id", 1);
});
