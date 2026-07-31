/**
 * @jest-environment node
 *
 * 购买成功后发放订阅点数（2026-08-01 提价工程）。
 *
 * 关键不变量：
 *  1. 点数是权益的「附赠」，发放链路必须 fail-open —— 点数失败/开关关闭/周期冲突
 *     都不能影响 iap_entitlements 授予、tier 升级、以及 webhook 的 2xx 响应。
 *  2. 用户还有活跃订阅周期时不能立刻刷新 —— credit_refresh_subscription 会把旧周期
 *     未用完的点清零（记 expire 流水），立即刷新等于吞掉用户已付费的点。
 *  3. Afdian 只能按金额反推产品，分档必须跟着新价走。
 *
 * mock 手法照搬 __tests__/iap.xorpay-amount.test.js（jest.mock + resetModules + 后 require）。
 */

// 点数服务整体 mock：逐测试改 getBalance / refreshSubscription 行为。
const mockCreditService = {
  getBalance: jest.fn(),
  refreshSubscription: jest.fn(),
};
jest.mock("../lib/credits/service", () => ({
  __esModule: true,
  creditService: mockCreditService,
  createCreditService: () => mockCreditService,
}));

const DAY_MS = 24 * 60 * 60 * 1000;

const MOCK_ENV = {
  IAP_ENABLED: "true",
  NEXT_PUBLIC_IAP_ENABLED: "true",
  IAP_PROVIDER: "mock",
  IAP_WEBHOOK_SECRET: "credit_grant_secret_789",
};

describe("购买成功 → 发放订阅点数", () => {
  const OLD_ENV = process.env;
  let handleWebhook;
  let buildMockWebhookPayload;
  let signMockWebhookPayload;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, ...MOCK_ENV };
    globalThis.__iapStore = undefined;
    mockCreditService.getBalance.mockReset();
    mockCreditService.refreshSubscription.mockReset();
    // 默认：开关开 + 无历史钱包周期
    mockCreditService.getBalance.mockResolvedValue({
      enabled: true,
      enforcementEnabled: false,
      wallet: { userCode: "ABCD12", subscriptionPoints: 0, purchasedPoints: 0, subscriptionPeriodEnd: null },
    });
    mockCreditService.refreshSubscription.mockResolvedValue({ ok: true, duplicate: false });

    ({ handleWebhook } = require("../lib/iap/service"));
    ({ buildMockWebhookPayload, signMockWebhookPayload } = require("../lib/iap/providers/mockProvider"));
  });

  afterEach(() => {
    process.env = OLD_ENV;
    globalThis.__iapStore = undefined;
    jest.restoreAllMocks();
  });

  function makeWebhook({ userCode = "ABCD12", productId = "pro_monthly" } = {}) {
    const rawBody = buildMockWebhookPayload({ userCode, productId });
    const headers = new Headers({ "x-iap-signature": signMockWebhookPayload(rawBody) });
    return { headers, rawBody, eventId: JSON.parse(rawBody).id };
  }

  // ── a) 开关开 + 无活跃周期 ────────────────────────────────

  test("开关开 + 无活跃周期 → 按套餐发点数（points/周期/幂等键正确）", async () => {
    const { headers, rawBody, eventId } = makeWebhook({ productId: "pro_monthly" });

    const before = Date.now();
    const result = await handleWebhook({ headers, rawBody });
    const after = Date.now();

    expect(result.granted).toBe(true);
    expect(result.credits).toMatchObject({ granted: true });
    expect(mockCreditService.refreshSubscription).toHaveBeenCalledTimes(1);

    const call = mockCreditService.refreshSubscription.mock.calls[0][0];
    expect(call.userCode).toBe("ABCD12");
    // pro_monthly = 100 点 / 30 天（lib/credits/catalog.js PLAN_ALLOWANCES）
    expect(call.points).toBe(100);
    expect(call.idempotencyKey).toBe(`iap-sub:mock:${eventId}`);
    expect(call.metadata).toEqual({ productId: "pro_monthly", provider: "mock", source: "iap_webhook" });

    const startMs = new Date(call.periodStart).getTime();
    const endMs = new Date(call.periodEnd).getTime();
    // periodStart = now 回拨 60s——RPC 用数据库时钟硬校验 period_start <= NOW()，
    // 回拨吸收 Vercel/Supabase 间的时钟偏移，绝不能落在未来。
    const SKEW_MS = 60 * 1000;
    expect(startMs).toBeGreaterThanOrEqual(before - SKEW_MS);
    expect(startMs).toBeLessThanOrEqual(after - SKEW_MS);
    expect(endMs - startMs).toBe(30 * DAY_MS + SKEW_MS);
    expect(call.periodStart).toBe(new Date(startMs).toISOString());
  });

  test("年卡 → 100 点 / 30 天（点数按 periodDays 走，不是订阅时长 365 天）", async () => {
    const yearly = makeWebhook({ userCode: "YEAR01", productId: "pro_yearly" });
    await handleWebhook(yearly);
    const call = mockCreditService.refreshSubscription.mock.calls[0][0];
    expect(call.points).toBe(100);
    expect(new Date(call.periodEnd) - new Date(call.periodStart)).toBe(30 * DAY_MS + 60 * 1000);
  });

  test("体验卡 → 30 点 / 7 天", async () => {
    // mock provider 用的是 USD 默认目录（只有 monthly/yearly），这里用 IAP_PRODUCTS_JSON
    // 注入体验卡即可，不影响点数配置（点数只认 lib/credits/catalog.js）。
    process.env.IAP_PRODUCTS_JSON = JSON.stringify([
      { id: "pro_weekly", title: "Pro 体验卡", priceCents: 1990, currency: "CNY", interval: "week", active: true },
    ]);

    const weekly = makeWebhook({ userCode: "WEEK01", productId: "pro_weekly" });
    await handleWebhook(weekly);

    const call = mockCreditService.refreshSubscription.mock.calls[0][0];
    expect(call.userCode).toBe("WEEK01");
    expect(call.points).toBe(30);
    expect(new Date(call.periodEnd) - new Date(call.periodStart)).toBe(7 * DAY_MS + 60 * 1000);
  });

  // ── b) 开关关 ────────────────────────────────────────────

  test("CREDITS_ENABLED 关 → 不发点数，但权益照常授予（可日后补发）", async () => {
    mockCreditService.getBalance.mockResolvedValue({ enabled: false, enforcementEnabled: false, wallet: null });

    const { headers, rawBody } = makeWebhook();
    const result = await handleWebhook({ headers, rawBody });

    expect(result.ok).toBe(true);
    expect(result.granted).toBe(true);
    expect(result.entitlement.productId).toBe("pro_monthly");
    expect(result.credits).toMatchObject({ granted: false, reason: "credits_disabled" });
    expect(mockCreditService.refreshSubscription).not.toHaveBeenCalled();
  });

  // ── c) 点数发放抛错 → fail-open ───────────────────────────

  test("refreshSubscription 抛错 → 权益仍授予，webhook 不冒泡异常", async () => {
    mockCreditService.refreshSubscription.mockRejectedValue(new Error("credit RPC exploded"));

    const { headers, rawBody } = makeWebhook();
    const result = await handleWebhook({ headers, rawBody });

    expect(result.ok).toBe(true);
    expect(result.granted).toBe(true);
    expect(result.credits).toMatchObject({ granted: false, reason: "error" });
  });

  test("getBalance 抛错（点数库不可用）→ 权益仍授予", async () => {
    mockCreditService.getBalance.mockRejectedValue(new Error("wallet snapshot unavailable"));

    const { headers, rawBody } = makeWebhook();
    const result = await handleWebhook({ headers, rawBody });

    expect(result.granted).toBe(true);
    expect(result.credits).toMatchObject({ granted: false, reason: "error" });
    expect(mockCreditService.refreshSubscription).not.toHaveBeenCalled();
  });

  // ── d) 活跃周期存在 → 跳过 ────────────────────────────────

  test("仍有活跃订阅周期（短期内二次购买）→ 跳过发放，绝不清零未用点数", async () => {
    mockCreditService.getBalance.mockResolvedValue({
      enabled: true,
      enforcementEnabled: false,
      wallet: {
        userCode: "ABCD12",
        subscriptionPoints: 88,
        purchasedPoints: 0,
        subscriptionPeriodStart: new Date(Date.now() - 3 * DAY_MS).toISOString(),
        subscriptionPeriodEnd: new Date(Date.now() + 20 * DAY_MS).toISOString(),
      },
    });

    const { headers, rawBody } = makeWebhook();
    const result = await handleWebhook({ headers, rawBody });

    expect(result.granted).toBe(true);
    expect(result.credits).toMatchObject({ granted: false, reason: "active_period" });
    expect(mockCreditService.refreshSubscription).not.toHaveBeenCalled();
  });

  test("上个周期已结束 → 正常发放新周期", async () => {
    mockCreditService.getBalance.mockResolvedValue({
      enabled: true,
      enforcementEnabled: false,
      wallet: {
        userCode: "ABCD12",
        subscriptionPoints: 0,
        purchasedPoints: 12,
        subscriptionPeriodStart: new Date(Date.now() - 40 * DAY_MS).toISOString(),
        subscriptionPeriodEnd: new Date(Date.now() - 10 * DAY_MS).toISOString(),
      },
    });

    const { headers, rawBody } = makeWebhook();
    const result = await handleWebhook({ headers, rawBody });

    expect(result.credits).toMatchObject({ granted: true });
    expect(mockCreditService.refreshSubscription).toHaveBeenCalledTimes(1);
  });

  // ── 去重：重复回调不重复发点数 ────────────────────────────

  test("同一事件重复回调 → 点数只发一次（webhook 层去重先拦住）", async () => {
    const { headers, rawBody } = makeWebhook();
    await handleWebhook({ headers, rawBody });
    const second = await handleWebhook({ headers, rawBody });

    expect(second.duplicate).toBe(true);
    expect(mockCreditService.refreshSubscription).toHaveBeenCalledTimes(1);
  });
});

// ── e) Afdian 金额分档（2026-08-01 新价）──────────────────────

describe("Afdian 金额分档（提价后）", () => {
  const { afdianProvider } = require("../lib/iap/providers/afdianProvider");

  function parseAmount(totalAmount) {
    const rawBody = JSON.stringify({
      ec: 200,
      em: "",
      data: {
        type: "order",
        order: {
          out_trade_no: `af_${totalAmount}`,
          status: 2,
          total_amount: String(totalAmount),
          remark: "ABC123",
        },
      },
    });
    return afdianProvider.parseWebhookEvent(rawBody).payload;
  }

  test.each([
    ["19.90", "pro_weekly", 7],
    ["59.90", "pro_monthly", 30],
    ["149.90", "pro_quarterly", 90],
    ["499.90", "pro_yearly", 365],
  ])("新价 ¥%s → %s / %i 天", (amount, productId, days) => {
    expect(parseAmount(amount)).toMatchObject({ productId, days });
  });

  test("旧价月卡金额 ¥29.99 → 降档到体验卡（不再白拿月卡）", () => {
    expect(parseAmount("29.99")).toMatchObject({ productId: "pro_weekly", days: 7 });
  });

  test("旧价年卡金额 ¥259.88 → 降档到季卡（不再白拿年卡）", () => {
    expect(parseAmount("259.88")).toMatchObject({ productId: "pro_quarterly", days: 90 });
  });

  test("分档阈值边界：¥40 / ¥120 / ¥400 恰好进上一档", () => {
    expect(parseAmount("39.99")).toMatchObject({ productId: "pro_weekly" });
    expect(parseAmount("40")).toMatchObject({ productId: "pro_monthly" });
    expect(parseAmount("119.99")).toMatchObject({ productId: "pro_monthly" });
    expect(parseAmount("120")).toMatchObject({ productId: "pro_quarterly" });
    expect(parseAmount("399.99")).toMatchObject({ productId: "pro_quarterly" });
    expect(parseAmount("400")).toMatchObject({ productId: "pro_yearly" });
  });
});
