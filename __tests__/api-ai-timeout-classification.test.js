/**
 * @jest-environment node
 */

/**
 * /api/ai 对「超时」的分类与留痕（2026-09-20 事故的后台侧）。
 *
 * 事故当天五次失败在后台只留下 stage=server / error_type=internal 的 500，
 * 查不出根因。超时必须自成一类：504 + upstream_timeout，且不能把上游自己回的
 * HTTP 504 也算进来——那是上游在报错，不是我们等不下去了。
 */

let mockSupabaseConfigured = false;
let mockUsersRow = null;
const mockInsertCalls = [];

jest.mock("../lib/supabaseAdmin", () => ({
  get isSupabaseAdminConfigured() { return mockSupabaseConfigured; },
  supabaseAdmin: {
    from(table) {
      const selectFilter = {
        eq() { return selectFilter; },
        async maybeSingle() {
          if (table === "users") return { data: mockUsersRow, error: null };
          return { data: null, error: null };
        },
      };
      return {
        select() { return selectFilter; },
        async insert(row) { mockInsertCalls.push({ table, row }); return { error: null }; },
      };
    },
    async rpc() { return { data: 1, error: null }; },
  },
}));

import { POST } from "../app/api/ai/route";

const savedEnv = {};

function aiRequest(body) {
  return new Request("http://localhost/api/ai", {
    method: "POST",
    body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, ...body }),
  });
}

beforeEach(() => {
  ["DEEPSEEK_PROXY_URL", "HTTPS_PROXY", "HTTP_PROXY"].forEach((k) => {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  });
  mockInsertCalls.length = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
  mockSupabaseConfigured = false;
  mockUsersRow = null;
  Object.entries(savedEnv).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
});

describe("clientTimeoutMs 校验", () => {
  test("不带就照旧（服务端用自己的默认预算）", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    const res = await POST(aiRequest({}));
    expect(res.status).toBe(200);
  });

  test("合法值放行", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    const res = await POST(aiRequest({ clientTimeoutMs: 60000 }));
    expect(res.status).toBe(200);
  });

  test.each([
    ["短到离谱", 100],
    ["长到离谱", 999999],
    ["非整数", 60000.5],
    ["非数字", "soon"],
  ])("非法值 %s → 400，且一次上游都不发", async (_label, clientTimeoutMs) => {
    global.fetch = jest.fn();
    const res = await POST(aiRequest({ clientTimeoutMs }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/clientTimeoutMs/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("超时分类", () => {
  test("我们自己掐断的超时 → 504 + code=UPSTREAM_TIMEOUT，文案不提「网络」", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("DeepSeek request timeout: upstream budget exhausted"));

    const res = await POST(aiRequest({}));
    const body = await res.json();

    expect(res.status).toBe(504);
    expect(body.code).toBe("UPSTREAM_TIMEOUT");
    expect(body.error).toContain("排队");
    expect(body.error).not.toContain("网络");
  });

  test("超时留痕成 error_type=upstream_timeout（后台可按这一类筛）", async () => {
    mockSupabaseConfigured = true;
    mockUsersRow = { tier: "pro", tier_expires_at: "2999-01-01T00:00:00.000Z" };
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error("DeepSeek stream stalled: no output for 45s"), {
        code: "UPSTREAM_STALL",
        retryable: false, // 本例只验留痕，不让它重试
      }),
    );

    const res = await POST(aiRequest({ userCode: "ABC123" }));

    expect(res.status).toBe(504);
    const row = mockInsertCalls.find((c) => c.table === "api_error_feedback")?.row;
    expect(row.error_type).toBe("upstream_timeout");
    expect(row.http_status).toBe(504);
    expect(row.error_detail).toContain("stalled");
  });

  test("多采样三路全超时 → 同样是 504，不是 502", async () => {
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error("DeepSeek request timeout"), { retryable: false }),
    );

    const res = await POST(aiRequest({ samples: 3 }));

    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe("UPSTREAM_TIMEOUT");
  });

  test("上游自己回 504 仍按上游错误记 502 —— 不许混进 upstream_timeout", async () => {
    mockSupabaseConfigured = true;
    mockUsersRow = { tier: "pro", tier_expires_at: "2999-01-01T00:00:00.000Z" };
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 504,
      text: async () => "<html>Gateway Time-out</html>",
    });

    const res = await POST(aiRequest({ userCode: "ABC123" }));

    expect(res.status).toBe(502);
    const row = mockInsertCalls.find((c) => c.table === "api_error_feedback" && c.row.stage === "deepseek")?.row;
    expect(row.error_type).toBe("upstream");
    expect(row.error_detail).toContain("upstream 504");
  });

  test("超时不计用量（失败的调用从不扣次数）", async () => {
    mockSupabaseConfigured = true;
    mockUsersRow = { tier: "pro", tier_expires_at: "2999-01-01T00:00:00.000Z" };
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error("DeepSeek request timeout"), { retryable: false }),
    );

    await POST(aiRequest({ userCode: "ABC123" }));

    expect(mockInsertCalls.find((c) => c.table === "daily_usage")).toBeUndefined();
  });
});
