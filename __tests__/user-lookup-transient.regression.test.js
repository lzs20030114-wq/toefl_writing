/**
 * @jest-environment node
 *
 * 回归:查库失败 ≠ 用户不存在。
 *
 * 线上事故 2026-09-12 16:54Z —— PostgREST 对 `GET /rest/v1/users` 回了一次 504,
 * 而调用方都写成 `const { data: user } = await ...` 把 error 丢了,于是:
 *   · /api/ai   → 403 "Invalid user."(练习记录里的 AI 解释直接红字 "API error 403")
 *   · IAP webhook → 静默跳过 Pro 升级,还回 2xx(钱收了、权益没发、provider 不再重试)
 * 本文件钉死修复后的三条语义:重试吸收抖动、失败回可重试状态、真·查无此人行为不变。
 */

let mockSupabaseConfigured = true;
let usersQueue = [];           // 每次 users 查询按序弹一个 { data, error }
const inserts = [];            // api_error_feedback 留痕

jest.mock("../lib/supabaseAdmin", () => ({
  get isSupabaseAdminConfigured() { return mockSupabaseConfigured; },
  supabaseAdmin: {
    from(table) {
      const filter = {
        eq() { return filter; },
        async maybeSingle() {
          if (table === "users") {
            return usersQueue.length ? usersQueue.shift() : { data: null, error: null };
          }
          return { data: null, error: null };   // daily_usage:今日无记录
        },
      };
      return {
        select() { return filter; },
        async insert(row) { inserts.push({ table, row }); return { error: null }; },
        update() { return { async eq() { return { error: null }; } }; },
      };
    },
    async rpc() { return { data: 1, error: null }; },
  },
}));

jest.mock("../lib/iap/repository", () => ({
  grantEntitlement: jest.fn(async (input) => ({ ...input, id: "ent_test" })),
  isWebhookEventProcessed: jest.fn(async () => false),
  markWebhookEventProcessed: jest.fn(async () => true),
  listEntitlementsByUser: jest.fn(async () => []),
}));

import { lookupUserTier } from "../lib/userLookup";
import { mapAiHelperError } from "../lib/ai/client";
import { POST } from "../app/api/ai/route";
import { handleWebhook } from "../lib/iap/service";
import { markWebhookEventProcessed } from "../lib/iap/repository";
import { buildMockWebhookPayload, signMockWebhookPayload } from "../lib/iap/providers/mockProvider";

const TRANSIENT = { message: "FetchError: gateway timeout" };
const PRO_ROW = { tier: "pro", tier_expires_at: "2999-01-01T00:00:00.000Z" };

beforeEach(() => {
  mockSupabaseConfigured = true;
  usersQueue = [];
  inserts.length = 0;
  jest.clearAllMocks();
});

describe("lookupUserTier", () => {
  test("一次瞬时失败后重试拿到用户(504 被吸收,调用方无感)", async () => {
    usersQueue = [{ data: null, error: TRANSIENT }, { data: PRO_ROW, error: null }];
    const { user, error } = await lookupUserTier("ABC123");
    expect(error).toBeNull();
    expect(user).toEqual(PRO_ROW);
    expect(usersQueue).toHaveLength(0);   // 确实重试了第二次
  });

  test("连续失败时返回 error,且绝不把 user 谎报成「不存在」", async () => {
    usersQueue = [{ data: null, error: TRANSIENT }, { data: null, error: TRANSIENT }];
    const { user, error } = await lookupUserTier("ABC123");
    expect(user).toBeNull();
    expect(error).toBe(TRANSIENT);
  });

  test("真·查无此人:error 为 null,由调用方判 403", async () => {
    usersQueue = [{ data: null, error: null }];
    const { user, error } = await lookupUserTier("NOBODY");
    expect(user).toBeNull();
    expect(error).toBeNull();
    expect(usersQueue).toHaveLength(0);   // 没有多余重试
  });
});

describe("/api/ai 的用户校验", () => {
  const savedProxy = {};
  beforeEach(() => {
    ["DEEPSEEK_PROXY_URL", "HTTPS_PROXY", "HTTP_PROXY"].forEach((k) => {
      savedProxy[k] = process.env[k];
      delete process.env[k];
    });
  });
  afterEach(() => {
    Object.entries(savedProxy).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    delete global.fetch;
  });

  const aiRequest = () => new Request("http://localhost/api/ai", {
    method: "POST",
    body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, userCode: "ABC123" }),
  });

  test("查库持续失败 → 503 可重试,不是 403", async () => {
    usersQueue = [{ data: null, error: TRANSIENT }, { data: null, error: TRANSIENT }];
    const res = await POST(aiRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(403);
    expect(body.code).toBe("USER_LOOKUP_FAILED");

    const row = inserts.find((i) => i.table === "api_error_feedback").row;
    expect(row.stage).toBe("auth");
    expect(row.error_type).toBe("user_lookup_failed");   // 不再污染 invalid_user 指标
    expect(row.http_status).toBe(503);
    expect(row.error_detail).toContain("gateway timeout");
  });

  test("查库抖一下就好 → 请求照常成功(用户根本看不到错误)", async () => {
    usersQueue = [{ data: null, error: TRANSIENT }, { data: PRO_ROW, error: null }];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "解析文本" } }] }),
    });

    const res = await POST(aiRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).content).toBe("解析文本");
    expect(inserts.filter((i) => i.table === "api_error_feedback")).toHaveLength(0);
  });

  test("码确实不存在时仍然回 403 Invalid user.(不回归)", async () => {
    usersQueue = [{ data: null, error: null }];
    const res = await POST(aiRequest());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Invalid user.");
    expect(inserts.find((i) => i.table === "api_error_feedback").row.error_type).toBe("invalid_user");
  });
});

describe("IAP webhook 的 tier 升级", () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      IAP_ENABLED: "true",
      NEXT_PUBLIC_IAP_ENABLED: "true",
      IAP_PROVIDER: "mock",
      IAP_WEBHOOK_SECRET: "regression_secret",
    };
  });
  afterEach(() => { process.env = OLD_ENV; });

  function signedWebhook() {
    const rawBody = buildMockWebhookPayload({ userCode: "TEST01", productId: "pro_monthly" });
    return { headers: new Headers({ "x-iap-signature": signMockWebhookPayload(rawBody) }), rawBody };
  }

  test("查库持续失败 → 抛 503 且不写 processed 标记,provider 会重试(钱不丢权益)", async () => {
    usersQueue = [{ data: null, error: TRANSIENT }, { data: null, error: TRANSIENT }];
    await expect(handleWebhook(signedWebhook())).rejects.toMatchObject({ status: 503 });
    expect(markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  test("查库抖一下就好 → 正常发权益并写 processed 标记", async () => {
    usersQueue = [{ data: null, error: TRANSIENT }, { data: { tier: "free", tier_expires_at: null }, error: null }];
    const result = await handleWebhook(signedWebhook());
    expect(result.ok).toBe(true);
    expect(markWebhookEventProcessed).toHaveBeenCalledTimes(1);
  });
});

describe("mapAiHelperError", () => {
  test("永远不把原始 'API error NNN' 甩给用户", () => {
    for (const status of [401, 402, 403, 429, 500, 502, 503]) {
      const err = Object.assign(new Error(`API error ${status}`), { status });
      expect(mapAiHelperError(err).toLowerCase()).not.toContain("api error");
    }
  });

  test("403 提示重新登录,503/查库失败提示重试", () => {
    expect(mapAiHelperError(Object.assign(new Error("API error 403"), { status: 403 }))).toContain("重新登录");
    const lookup = Object.assign(new Error("API error 503"), { status: 503, code: "USER_LOOKUP_FAILED" });
    expect(mapAiHelperError(lookup)).toBe("服务暂时不可用，请重试");
  });

  test("免费额度用尽给升级路径,超时给重试路径", () => {
    const capped = Object.assign(new Error("API error 429"), { status: 429, code: "DAILY_LIMIT" });
    expect(mapAiHelperError(capped)).toContain("Pro");
    expect(mapAiHelperError(new Error("API timeout"))).toContain("超时");
  });
});
