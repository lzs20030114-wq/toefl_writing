/**
 * @jest-environment node
 *
 * Server-side daily-usage metering in /api/ai.
 *
 * The companion api-ai-route.test.js runs with Supabase admin UNCONFIGURED, so
 * it never exercises the usage path. Here we mock supabaseAdmin as configured to
 * verify the limit is enforced before a DeepSeek call is spent, that a credit is
 * consumed atomically only on success, and that we fall back gracefully if the
 * increment RPC isn't installed yet.
 */

let mockUsersRow = null;
let mockUsageRow = null;
let mockRpcImpl = null;
const mockRpcCalls = [];
const mockUpdateCalls = [];
const mockInsertCalls = [];

jest.mock("../lib/supabaseAdmin", () => {
  function makeFrom(table) {
    const selectFilter = {
      eq() { return selectFilter; },
      async maybeSingle() {
        if (table === "users") return { data: mockUsersRow, error: null };
        if (table === "daily_usage") return { data: mockUsageRow, error: null };
        return { data: null, error: null };
      },
    };
    function updateFilter(vals) {
      const f = {
        eq() { return f; },
        // thenable so `await from().update().eq().eq()` resolves
        then(resolve, reject) {
          mockUpdateCalls.push({ table, vals });
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return f;
    }
    return {
      select() { return selectFilter; },
      async insert(row) { mockInsertCalls.push({ table, row }); return { error: null }; },
      update(vals) { return updateFilter(vals); },
    };
  }
  return {
    isSupabaseAdminConfigured: true,
    supabaseAdmin: {
      from: (table) => makeFrom(table),
      rpc: async (name, args) => {
        mockRpcCalls.push({ name, args });
        return mockRpcImpl ? mockRpcImpl(name, args) : { data: 1, error: null };
      },
    },
  };
});

import { POST } from "../app/api/ai/route";

const TODAY = new Date().toISOString().split("T")[0];

function aiRequest(extra = {}) {
  return new Request("http://localhost/api/ai", {
    method: "POST",
    body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, userCode: "ABC123", ...extra }),
  });
}

describe("/api/ai server-side usage metering", () => {
  const savedEnv = {};
  beforeEach(() => {
    // Force the direct-fetch path (not the curl proxy).
    ["DEEPSEEK_PROXY_URL", "HTTPS_PROXY", "HTTP_PROXY"].forEach((k) => {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    });
    mockUsersRow = { tier: "free", tier_expires_at: null };
    mockUsageRow = null;
    mockRpcImpl = null;
    mockRpcCalls.length = 0;
    mockUpdateCalls.length = 0;
    mockInsertCalls.length = 0;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Object.entries(savedEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  });

  test("rejects with 403 when no user code is supplied", async () => {
    const res = await POST(aiRequest({ userCode: "" }));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockRpcCalls).toHaveLength(0);
  });

  test("free user under limit: scores and increments via RPC with cap 3", async () => {
    mockUsageRow = { usage_count: 2 };
    const res = await POST(aiRequest());
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockRpcCalls).toHaveLength(1);
    expect(mockRpcCalls[0].name).toBe("increment_daily_usage");
    expect(mockRpcCalls[0].args).toEqual({
      p_user_code: "ABC123", p_count: 1, p_cap: 3, p_date: TODAY,
    });
  });

  test("free user AT the limit: 429 BEFORE calling DeepSeek, no increment (closes the bypass)", async () => {
    mockUsageRow = { usage_count: 3 };
    const res = await POST(aiRequest());
    expect(res.status).toBe(429);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockRpcCalls).toHaveLength(0);
  });

  test("active pro user gets the 100 cap, not 3", async () => {
    mockUsersRow = { tier: "pro", tier_expires_at: "2999-01-01T00:00:00.000Z" };
    mockUsageRow = { usage_count: 50 };
    const res = await POST(aiRequest());
    expect(res.status).toBe(200);
    expect(mockRpcCalls).toHaveLength(1);
    expect(mockRpcCalls[0].args.p_cap).toBe(100);
  });

  test("expired pro is metered as free (cap 3)", async () => {
    mockUsersRow = { tier: "pro", tier_expires_at: "2000-01-01T00:00:00.000Z" };
    mockUsageRow = { usage_count: 1 };
    const res = await POST(aiRequest());
    expect(res.status).toBe(200);
    expect(mockRpcCalls[0].args.p_cap).toBe(3);
  });

  test("does NOT consume a credit when the AI call fails (upstream error)", async () => {
    mockUsageRow = { usage_count: 1 };
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "upstream boom" });
    const res = await POST(aiRequest());
    expect(res.status).toBe(502);
    expect(mockRpcCalls).toHaveLength(0); // increment only happens on success
    expect(mockUpdateCalls).toHaveLength(0);
  });

  test("falls back to a non-atomic upsert when the increment RPC is missing", async () => {
    mockUsageRow = { usage_count: 1 };
    mockRpcImpl = () => ({ data: null, error: { message: "function increment_daily_usage does not exist" } });
    const res = await POST(aiRequest());
    expect(res.status).toBe(200);
    expect(mockRpcCalls).toHaveLength(1);     // RPC attempted
    expect(mockUpdateCalls).toHaveLength(1);  // then fell back to a read-then-write
    expect(mockUpdateCalls[0].vals).toEqual({ usage_count: 2 });
  });
});
