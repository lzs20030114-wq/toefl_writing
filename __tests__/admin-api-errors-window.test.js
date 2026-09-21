/**
 * @jest-environment node
 */
// /api/admin/api-errors 的时间窗口必须同时作用于「统计卡」和「下面的列表」。
//
// 2026-09-21 之前 sinceIso 只喂给了统计查询,rows 是「不限时间的最新 N 条」:
// 页面上把窗口从 24 小时切到 60 分钟,上面的数字变了、下面的表格纹丝不动,
// 于是一条几天前的旧记录会被当成「刚刚发生的」。这条测试钉住两边同窗口。

const queries = [];

jest.mock("../lib/adminAuth", () => ({ isAdminAuthorized: () => true }));
jest.mock("../lib/supabaseAdmin", () => ({
  isSupabaseAdminConfigured: true,
  supabaseAdmin: {
    from(table) {
      const q = { table, select: "", filters: [], limit: 0 };
      queries.push(q);
      const api = {
        select(cols) { q.select = cols; return api; },
        gte(col, val) { q.filters.push({ op: "gte", col, val }); return api; },
        eq(col, val) { q.filters.push({ op: "eq", col, val }); return api; },
        order() { return api; },
        limit(n) { q.limit = n; return api; },
        then(resolve, reject) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  },
}));

import { GET } from "../app/api/admin/api-errors/route";

function call(qs) {
  return GET(new Request(`http://localhost/api/admin/api-errors?${qs}`, {
    method: "GET",
    headers: { "x-admin-token": "t" },
  }));
}

describe("/api/admin/api-errors 时间窗口", () => {
  beforeEach(() => { queries.length = 0; });

  test("列表查询和统计查询用的是同一个 created_at 下界", async () => {
    const before = Date.now();
    const res = await call("minutes=60&limit=200");
    expect(res.status).toBe(200);

    // queries[0] = 列表(带 error_detail 等完整列),queries[1] = 统计
    const rowsQuery = queries.find((q) => q.select.includes("error_detail"));
    const statsQuery = queries.find((q) => !q.select.includes("error_detail"));
    expect(rowsQuery).toBeDefined();
    expect(statsQuery).toBeDefined();

    const rowsGte = rowsQuery.filters.find((f) => f.op === "gte" && f.col === "created_at");
    const statsGte = statsQuery.filters.find((f) => f.op === "gte" && f.col === "created_at");
    // 关键:列表以前根本没有这一条过滤。
    expect(rowsGte).toBeDefined();
    expect(statsGte).toBeDefined();
    expect(rowsGte.val).toBe(statsGte.val);

    // 60 分钟窗口应落在「大约一小时前」。
    const delta = before - new Date(rowsGte.val).getTime();
    expect(delta).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5000);
    expect(delta).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
  });

  test("窗口变大时列表的下界跟着变", async () => {
    await call("minutes=60");
    const short = queries.find((q) => q.select.includes("error_detail"))
      .filters.find((f) => f.op === "gte").val;

    queries.length = 0;
    await call("minutes=10080");
    const long = queries.find((q) => q.select.includes("error_detail"))
      .filters.find((f) => f.op === "gte").val;

    expect(new Date(long).getTime()).toBeLessThan(new Date(short).getTime());
  });

  test("状态码/类型过滤仍然生效,且不影响时间下界", async () => {
    await call("minutes=1440&status=502&errorType=empty_content");
    const rowsQuery = queries.find((q) => q.select.includes("error_detail"));
    expect(rowsQuery.filters).toEqual(expect.arrayContaining([
      { op: "eq", col: "http_status", val: 502 },
      { op: "eq", col: "error_type", val: "empty_content" },
    ]));
    expect(rowsQuery.filters.some((f) => f.op === "gte" && f.col === "created_at")).toBe(true);
  });
});
