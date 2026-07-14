/**
 * @jest-environment node
 */

// logApiFailure 只在 supabaseAdmin 已配置时才写 api_error_feedback,而本文件
// 其余用例特意在「未配置」状态下跑(测试环境无 Supabase env,与真模块行为一致)。
// 这里用 getter 做可切换的 mock:默认 false 保持全部既有用例行为不变;
// 「partial-failure logging」describe 按需切到 true 以观测错误表插入。
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
          return { data: null, error: null }; // daily_usage → 今日无记录
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

describe("/api/ai route", () => {
  const savedEnv = {};
  beforeEach(() => {
    // Ensure tests use the fetch path, not the curl proxy path
    ["DEEPSEEK_PROXY_URL", "HTTPS_PROXY", "HTTP_PROXY"].forEach((k) => {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Object.entries(savedEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  });

  test("returns parsed content when upstream succeeds", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{\"score\":4}" } }] }),
    });

    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m", maxTokens: 100 }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.content).toBe("{\"score\":4}");
  });

  test("normalizes maxTokens and temperature to numbers before upstream call", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });

    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m", maxTokens: "100", temperature: "0.8" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const [, options] = global.fetch.mock.calls[0];
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody.max_tokens).toBe(100);
    expect(typeof parsedBody.max_tokens).toBe("number");
    expect(parsedBody.temperature).toBe(0.8);
    expect(typeof parsedBody.temperature).toBe("number");
  });

  test("passes through upstream error status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });

    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m" }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toMatch(/unavailable|retry/i);
  });

  test("rejects invalid oversized request body", async () => {
    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "x".repeat(50000), maxTokens: 100 }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/too long/i);
  });

  test("rejects token requests above the 8192-token writing-report ceiling", async () => {
    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m", maxTokens: 8193 }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("8192");
  });

  test("rejects cross-origin browser request", async () => {
    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { origin: "https://evil.example", host: "localhost" },
      body: JSON.stringify({ system: "s", message: "m", maxTokens: 100 }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/forbidden origin/i);
  });

  test("rejects oversized request by content-length header", async () => {
    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "content-length": "130000" },
      body: JSON.stringify({ system: "s", message: "m", maxTokens: 100 }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(413);
    expect(body.error).toMatch(/too large/i);
  });

  // ── samples 参数(三路取中位的服务端 fan-out)────────────────
  describe("samples validation", () => {
    test.each([
      ["zero", 0],
      ["above max", 4],
      ["non-integer", 1.5],
      ["non-numeric string", "abc"],
    ])("rejects invalid samples (%s)", async (_label, samples) => {
      const req = new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, samples }),
      });
      const res = await POST(req);
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toMatch(/samples must be an integer between 1 and 3/i);
    });

    test("defaults to a single call (no contents field) when samples omitted", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "solo" } }] }),
      });

      const req = new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100 }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.content).toBe("solo");
      expect(body.contents).toBeUndefined();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test("samples=3 fans out 3 upstream calls and returns a contents array", async () => {
      let n = 0;
      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: `sample-${++n}` } }] }),
      }));

      const req = new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, samples: 3 }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(Array.isArray(body.contents)).toBe(true);
      expect(body.contents).toHaveLength(3);
      expect(body.content).toBe(body.contents[0]);
    });

    test("samples=3 tolerates a partial failure (2 succeed, 1 fails)", async () => {
      let n = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        n += 1;
        if (n === 2) return { ok: false, status: 500, text: async () => "boom" };
        return { ok: true, json: async () => ({ choices: [{ message: { content: `ok-${n}` } }] }) };
      });

      const req = new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, samples: 3 }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.contents).toHaveLength(2);
      expect(body.content).toBe(body.contents[0]);
    });

    test("samples>1 with zero successes returns fail() upstream shape", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "all down",
      });

      const req = new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, samples: 2 }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.error).toMatch(/unavailable|retry/i);
    });
  });

  // ── 修6:多采样部分失败留痕(stage=deepseek_partial)────────────
  describe("partial-failure logging (deepseek_partial)", () => {
    beforeEach(() => {
      mockSupabaseConfigured = true;
      mockUsersRow = { tier: "pro", tier_expires_at: "2999-01-01T00:00:00.000Z" };
      mockInsertCalls.length = 0;
    });
    afterEach(() => {
      mockSupabaseConfigured = false;
      mockUsersRow = null;
    });

    function fanoutRequest() {
      return new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, samples: 3, userCode: "ABC123" }),
      });
    }

    test("logs each rejected sample to api_error_feedback while the request still succeeds", async () => {
      let n = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        n += 1;
        if (n === 2) return { ok: false, status: 500, text: async () => "boom" };
        return { ok: true, json: async () => ({ choices: [{ message: { content: `ok-${n}` } }] }) };
      });

      const res = await POST(fanoutRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.contents).toHaveLength(2);
      const errorLogs = mockInsertCalls.filter((c) => c.table === "api_error_feedback");
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].row.stage).toBe("deepseek_partial");
      expect(errorLogs[0].row.error_type).toBe("upstream_partial");
      expect(errorLogs[0].row.http_status).toBe(500);
      expect(errorLogs[0].row.error_detail).toBe("boom");
    });

    test("does not log when all samples succeed", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      });

      const res = await POST(fanoutRequest());

      expect(res.status).toBe(200);
      expect(mockInsertCalls.filter((c) => c.table === "api_error_feedback")).toHaveLength(0);
    });
  });
});
