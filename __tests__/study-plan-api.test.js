/**
 * @jest-environment node
 *
 * app/api/study-plan POST —— 备考计划落库端点。
 * 重点锁定 fail-open:迁移未跑(列不存在)时必须软失败(200 + pending),
 * 绝不返回 4xx/5xx,否则用户保存计划会看到报错。
 */

// 可配置的 supabaseAdmin mock:update().eq().select() 链返回 holder.result。
const holder = { result: { data: [{ code: "ABC123" }], error: null }, lastUpdate: null };
jest.mock("../lib/supabaseAdmin", () => ({
  __esModule: true,
  isSupabaseAdminConfigured: true,
  supabaseAdmin: {
    from: () => ({
      update: (payload) => {
        holder.lastUpdate = payload;
        return { eq: () => ({ select: () => Promise.resolve(holder.result) }) };
      },
    }),
  },
}));

// 限流器直通(不干扰)。
jest.mock("../lib/rateLimit", () => ({
  __esModule: true,
  createRateLimiter: () => ({ isLimited: () => false }),
  getIp: () => "1.2.3.4",
}));

const { POST } = require("../app/api/study-plan/route");

function req(body) {
  return { headers: new Headers(), json: async () => body };
}

beforeEach(() => {
  holder.result = { data: [{ code: "ABC123" }], error: null };
  holder.lastUpdate = null;
});

test("有效保存 → 写入四个字段,返回 ok+persisted", async () => {
  const res = await POST(req({ code: "abc123", examDate: "2026-09-15", targetScore: 5, currentScore: 3.5 }));
  expect(res.status).toBe(200);
  const j = await res.json();
  expect(j).toEqual({ ok: true, persisted: true });
  expect(holder.lastUpdate.exam_date).toBe("2026-09-15");
  expect(holder.lastUpdate.target_score).toBe(5);
  expect(holder.lastUpdate.current_score).toBe(3.5);
  expect(typeof holder.lastUpdate.study_plan_updated_at).toBe("string");
});

test("fail-open:列不存在(迁移未跑)→ 200 + pending,不报错", async () => {
  holder.result = { data: null, error: { code: "42703", message: 'column "exam_date" does not exist' } };
  const res = await POST(req({ code: "ABC123", examDate: "2026-09-15" }));
  expect(res.status).toBe(200);
  const j = await res.json();
  expect(j).toEqual({ ok: false, persisted: false, pending: true });
});

test("fail-open:PostgREST schema 缓存未刷新(PGRST204)→ 200 + pending", async () => {
  holder.result = { data: null, error: { code: "PGRST204", message: "Could not find the 'exam_date' column of 'users' in the schema cache" } };
  const res = await POST(req({ code: "ABC123" }));
  expect(res.status).toBe(200);
  expect((await res.json()).pending).toBe(true);
});

test("code 不存在(0 行受影响)→ 软失败 persisted:false,不报错", async () => {
  holder.result = { data: [], error: null };
  const res = await POST(req({ code: "ZZZZZZ", examDate: null }));
  const j = await res.json();
  expect(j).toEqual({ ok: true, persisted: false });
});

test("examDate 为 null 合法(清空计划)", async () => {
  const res = await POST(req({ code: "ABC123", examDate: null, targetScore: null, currentScore: null }));
  expect(res.status).toBe(200);
  expect(holder.lastUpdate.exam_date).toBeNull();
});

test("缺 code → 400", async () => {
  expect((await POST(req({ examDate: "2026-09-15" }))).status).toBe(400);
});

test("非法 examDate 格式 → 400", async () => {
  expect((await POST(req({ code: "ABC123", examDate: "2026/09/15" }))).status).toBe(400);
  expect((await POST(req({ code: "ABC123", examDate: "not-a-date" }))).status).toBe(400);
});

test("越界分数 → 400", async () => {
  expect((await POST(req({ code: "ABC123", targetScore: 9 }))).status).toBe(400);
  expect((await POST(req({ code: "ABC123", currentScore: 0 }))).status).toBe(400);
});

test("真库错误(非列缺失)→ 400", async () => {
  holder.result = { data: null, error: { code: "XX000", message: "some db failure" } };
  expect((await POST(req({ code: "ABC123" }))).status).toBe(400);
});
