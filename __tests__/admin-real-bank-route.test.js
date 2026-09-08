/**
 * @jest-environment node
 *
 * /api/admin/real-bank 路由：鉴权、分页拉取、days 参数、返回形状。
 * Supabase 按 __tests__/api-ai-route.test.js 的约定 mock。
 */
let pages = [];          // 每次 range() 返回的一页
let captured = [];       // { select, gte, range } 调用记录

jest.mock("../lib/supabaseAdmin", () => ({
  isSupabaseAdminConfigured: true,
  supabaseAdmin: {
    from() {
      const call = { select: null, gte: null, range: null };
      const builder = {
        select(cols) { call.select = cols; return builder; },
        order() { return builder; },
        gte(col, v) { call.gte = [col, v]; return builder; },
        range(from, to) {
          call.range = [from, to];
          captured.push(call);
          const page = pages.shift() || { data: [], error: null };
          return Promise.resolve(page);
        },
      };
      return builder;
    },
  },
}));

const { GET } = require("../app/api/admin/real-bank/route");

function req(query = "", token = "secret") {
  const headers = new Headers();
  if (token) headers.set("x-admin-token", token);
  return new Request(`http://localhost/api/admin/real-bank${query}`, { headers });
}

beforeEach(() => {
  process.env.ADMIN_DASHBOARD_TOKEN = "secret";
  pages = [];
  captured = [];
});

test("无口令 → 401", async () => {
  const res = await GET(req("", ""));
  expect(res.status).toBe(401);
});

test("默认 30 天：带 gte 过滤，投影真题字段，返回聚合", async () => {
  pages = [{
    data: [
      { user_code: "A", type: "reading", date: new Date().toISOString(), score: { correct: 3, total: 5 }, subtype: "rdl", itemId: "real_rdl_1" },
      { user_code: "B", type: "reading", date: new Date().toISOString(), score: { correct: 3, total: 5 }, subtype: "rdl", itemId: "rdl_1" },
    ],
    error: null,
  }];
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.days).toBe(30);
  expect(body.realSessions).toBe(1);
  expect(body.allSessions).toBe(2);
  expect(body.daily).toHaveLength(30);
  expect(captured[0].gte[0]).toBe("date");
  expect(captured[0].select).toContain("itemId:details->>itemId");
  expect(captured[0].select).toContain("bsQid:details->0->>qid");
  expect(captured[0].select).not.toContain("details,");
});

test("days=all → 不加时间过滤，且按 1000 一页翻到底", async () => {
  const mk = (i) => ({ user_code: `U${i}`, type: "bs", date: "2026-01-01T00:00:00Z", score: { correct: 1, total: 1 }, bsQid: "real_bs_1" });
  pages = [
    { data: Array.from({ length: 1000 }, (_, i) => mk(i)), error: null },
    { data: [mk(1000)], error: null },
  ];
  const res = await GET(req("?days=all"));
  const body = await res.json();
  expect(body.days).toBe(0);
  expect(body.realSessions).toBe(1001);
  expect(captured).toHaveLength(2);
  expect(captured[0].gte).toBeNull();
  expect(captured[1].range).toEqual([1000, 1999]);
});

test("Supabase 报错 → 400", async () => {
  pages = [{ data: null, error: { message: "boom" } }];
  const res = await GET(req("?days=7"));
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe("boom");
});
