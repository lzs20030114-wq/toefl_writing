/** @jest-environment node */
const mockVision = jest.fn(), mockGate = jest.fn(), mockLimited = jest.fn();
jest.mock("../lib/ai/qwenVision", () => ({ callQwenVision: (...args) => mockVision(...args), bufferToDataUrl: () => "data:image/png;base64,test" }));
jest.mock("../lib/userBankAuth", () => ({ gateUserBankRequest: (...args) => mockGate(...args) }));
jest.mock("../lib/ai/routeGuards", () => ({ isOriginAllowed: (request) => request.headers.get("origin") !== "https://evil.test" }));
jest.mock("../lib/rateLimit", () => ({ createRateLimiter: () => ({ isLimited: (...args) => mockLimited(...args) }), getIp: () => "127.0.0.1" }));
const { POST } = require("../app/api/vocab/extract-image/route");
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
function request(images = [png], headers = {}) {
  const form = new FormData(); form.set("userCode", "TEST01");
  images.forEach((image) => form.append("image", new Blob([image]), "list.png"));
  return new Request("http://localhost/api/vocab/extract-image", { method: "POST", body: form, headers });
}
beforeEach(() => { jest.clearAllMocks(); process.env.DASHSCOPE_API_KEY = "test-only"; mockGate.mockResolvedValue({ ok: true }); mockLimited.mockReturnValue(false); });
afterAll(() => { delete process.env.DASHSCOPE_API_KEY; });
test("valid extraction only returns normalized preview, never writes or invents definitions", async () => {
  mockVision.mockResolvedValue({ content: '```json\n[{"word":"Apple","def":"苹果"},{"word":"apple"},{"word":"I am excited"},{"word":"banana"}]\n```' });
  const response = await POST(request()); const body = await response.json();
  expect(response.status).toBe(200); expect(body.ok).toBe(true); expect(body.items.map((e) => e.word)).toEqual(["apple", "banana"]); expect(body.items[1].def).toBe(""); expect(body.duplicates).toBe(1); expect(body.skipped).toBe(1);
});
test.each([["origin", () => request([png], { origin: "https://evil.test" }), 403], ["bad magic", () => request([new Uint8Array([1, 2, 3])]), 415], ["image count", () => request([png, png, png, png]), 413], ["aggregate bytes", () => request([new Uint8Array(4 * 1024 * 1024 + 1)]), 413]])("%s fails before paid call", async (_, create, status) => {
  const response = await POST(create()); expect(response.status).toBe(status); expect((await response.json()).ok).toBe(false); expect(mockVision).not.toHaveBeenCalled();
});
test("Pro guard and daily/IP quotas block paid calls with the vocabulary message", async () => {
  mockGate.mockResolvedValue({ ok: false, status: 403, code: "PRO_REQUIRED", error: "个人题库" });
  const response = await POST(request()); expect(response.status).toBe(403); expect((await response.json()).error).toContain("图片识别需要 Pro"); expect(mockVision).not.toHaveBeenCalled();
  mockLimited.mockReturnValue(true); expect((await POST(request())).status).toBe(429);
});
test("missing key, upstream failure, truncated JSON and non-list response are explicit failures", async () => {
  delete process.env.DASHSCOPE_API_KEY; expect((await POST(request())).status).toBe(503);
  process.env.DASHSCOPE_API_KEY = "test-only"; mockVision.mockRejectedValueOnce(new Error("secret provider details")); expect((await POST(request())).status).toBe(502);
  mockVision.mockResolvedValue({ content: '[{"word":"apple"},' }); const partial = await POST(request()); expect(partial.status).toBe(422); expect((await partial.json()).error).toContain("尚未导入");
  mockVision.mockResolvedValue({ content: '{"error":"TOO_MANY_ENTRIES"}' }); expect((await POST(request())).status).toBe(422);
});
test.each([
  { word: "apple", def: { text: "苹果" } },
  { word: "apple", phonetic: 123 },
  { word: "apple", sentence: ["An apple."] },
  { word: "apple", def: null },
  { word: 123 },
  null,
  "apple",
  { word: "apple", def: "义".repeat(3001) },
  { word: "apple", sentence: "s".repeat(401) },
  { word: "apple", phonetic: "p".repeat(161) },
  { word: "a".repeat(61) },
])("a malformed model item rejects the whole extraction without a partial preview: %p", async (invalid) => {
  mockVision.mockResolvedValue({ content: JSON.stringify([{ word: "banana", def: "香蕉" }, invalid]) });
  const response = await POST(request()), body = await response.json();
  expect(response.status).toBe(422); expect(body.ok).toBe(false);
  expect(body.error).toContain("尚未导入"); expect(body).not.toHaveProperty("items");
});
test("optional empty fields may be omitted and accepted field boundaries preserve all text", async () => {
  mockVision.mockResolvedValue({ content: JSON.stringify([{ word: "banana" }, { word: "apple", def: "d".repeat(3000), phonetic: "p".repeat(160), sentence: "s".repeat(400) }]) });
  const response = await POST(request()), body = await response.json();
  expect(response.status).toBe(200);
  expect(body.items[0]).toMatchObject({ word: "banana", def: "", phonetic: "", sentence: "" });
  expect(body.items[1]).toMatchObject({ def: "d".repeat(3000), phonetic: "p".repeat(160), sentence: "s".repeat(400) });
});
