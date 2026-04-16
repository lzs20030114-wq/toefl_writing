/**
 * @jest-environment node
 *
 * IAP 支付流 集成测试
 * 覆盖：完整 webhook 流程、签名验证、去重、tier 升级、续费叠加、边界情况
 */

import { handleWebhook, createCheckoutSession, getUserEntitlements } from "../lib/iap/service";
import { buildMockWebhookPayload, signMockWebhookPayload } from "../lib/iap/providers/mockProvider";

const MOCK_ENV = {
  IAP_ENABLED: "true",
  NEXT_PUBLIC_IAP_ENABLED: "true",
  IAP_PROVIDER: "mock",
  IAP_WEBHOOK_SECRET: "integration_test_secret_456",
};

function makeSignedWebhook(overrides = {}) {
  const rawBody = buildMockWebhookPayload({
    userCode: "TEST01",
    productId: "pro_monthly",
    ...overrides,
  });
  const signature = signMockWebhookPayload(rawBody);
  const headers = new Headers({ "x-iap-signature": signature });
  return { headers, rawBody };
}

describe("IAP integration: full webhook flow", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, ...MOCK_ENV };
    globalThis.__iapStore = undefined;
  });

  afterEach(() => {
    process.env = OLD_ENV;
    globalThis.__iapStore = undefined;
  });

  // ── Happy path ────────────────────────────────────────

  test("complete checkout flow: webhook → entitlement → dedup", async () => {
    const { headers, rawBody } = makeSignedWebhook();

    // First webhook: should process and grant entitlement
    const first = await handleWebhook({ headers, rawBody });
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.granted).toBe(true);
    expect(first.entitlement).toBeDefined();
    expect(first.entitlement.productId).toBe("pro_monthly");
    expect(first.entitlement.userCode).toBe("TEST01");

    // Second identical webhook: should be deduplicated
    const second = await handleWebhook({ headers, rawBody });
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.granted).toBeUndefined();
  });

  test("entitlements list reflects granted products", async () => {
    const { headers, rawBody } = makeSignedWebhook({ productId: "pro_yearly" });
    await handleWebhook({ headers, rawBody });

    const entitlements = await getUserEntitlements("TEST01");
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0].productId).toBe("pro_yearly");
    expect(entitlements[0].status).toBe("active");
  });

  test("multiple products for same user stack correctly", async () => {
    // First purchase: monthly
    const w1 = makeSignedWebhook({ productId: "pro_monthly" });
    await handleWebhook(w1);

    // Second purchase: yearly (different event ID via buildMockWebhookPayload)
    const w2 = makeSignedWebhook({ productId: "pro_yearly" });
    await handleWebhook(w2);

    const entitlements = await getUserEntitlements("TEST01");
    expect(entitlements).toHaveLength(2);
    const productIds = entitlements.map((e) => e.productId).sort();
    expect(productIds).toEqual(["pro_monthly", "pro_yearly"]);
  });

  // ── Signature verification ────────────────────────────

  test("rejects webhook with missing signature", async () => {
    const rawBody = buildMockWebhookPayload({ userCode: "TEST01", productId: "pro_monthly" });
    const headers = new Headers(); // no signature

    await expect(handleWebhook({ headers, rawBody })).rejects.toThrow(/signature/i);
  });

  test("rejects webhook with invalid signature", async () => {
    const rawBody = buildMockWebhookPayload({ userCode: "TEST01", productId: "pro_monthly" });
    const headers = new Headers({ "x-iap-signature": "totally_wrong_sig" });

    await expect(handleWebhook({ headers, rawBody })).rejects.toThrow(/signature/i);
  });

  test("rejects webhook with tampered payload", async () => {
    const rawBody = buildMockWebhookPayload({ userCode: "TEST01", productId: "pro_monthly" });
    const signature = signMockWebhookPayload(rawBody);
    const headers = new Headers({ "x-iap-signature": signature });

    // Tamper with payload after signing
    const tampered = rawBody.replace("TEST01", "HACK99");
    await expect(handleWebhook({ headers, rawBody: tampered })).rejects.toThrow(/signature/i);
  });

  // ── Input validation ──────────────────────────────────

  test("handles webhook with missing userCode gracefully", async () => {
    const rawBody = buildMockWebhookPayload({ userCode: "", productId: "pro_monthly" });
    const signature = signMockWebhookPayload(rawBody);
    const headers = new Headers({ "x-iap-signature": signature });

    // Should not throw — returns ok with error flag
    const result = await handleWebhook({ headers, rawBody });
    expect(result.ok).toBe(true);
    expect(result.error).toBe("no_user_code");
  });

  test("rejects webhook with invalid product ID", async () => {
    const rawBody = buildMockWebhookPayload({ userCode: "TEST01", productId: "nonexistent_plan" });
    const signature = signMockWebhookPayload(rawBody);
    const headers = new Headers({ "x-iap-signature": signature });

    await expect(handleWebhook({ headers, rawBody })).rejects.toThrow(/not available|not found/i);
  });

  test("rejects malformed JSON payload", async () => {
    const rawBody = "this is not json {{{";
    const signature = signMockWebhookPayload(rawBody);
    const headers = new Headers({ "x-iap-signature": signature });

    await expect(handleWebhook({ headers, rawBody })).rejects.toThrow(/json/i);
  });

  // ── Checkout session creation ─────────────────────────

  test("creates checkout session with valid input", async () => {
    const session = await createCheckoutSession({
      userCode: "TEST01",
      productId: "pro_monthly",
      successUrl: "https://example.com/success",
    });

    expect(session.provider).toBe("mock");
    expect(session.checkoutId).toBeDefined();
    expect(session.productId).toBe("pro_monthly");
    expect(session.amountCents).toBeGreaterThan(0);
  });

  test("rejects checkout with missing userCode", async () => {
    await expect(
      createCheckoutSession({ userCode: "", productId: "pro_monthly" }),
    ).rejects.toThrow(/userCode/i);
  });

  test("rejects checkout with invalid product", async () => {
    await expect(
      createCheckoutSession({ userCode: "TEST01", productId: "fake_product" }),
    ).rejects.toThrow(/not available|not found/i);
  });

  // ── Event type handling ───────────────────────────────

  test("ignores non-checkout event types", async () => {
    const rawBody = buildMockWebhookPayload({
      userCode: "TEST01",
      productId: "pro_monthly",
      eventType: "order.refunded",
    });
    const signature = signMockWebhookPayload(rawBody);
    const headers = new Headers({ "x-iap-signature": signature });

    const result = await handleWebhook({ headers, rawBody });
    expect(result.ok).toBe(true);
    expect(result.ignored).toBe(true);
    expect(result.granted).toBeUndefined();
  });

  // ── Feature gate ──────────────────────────────────────

  test("rejects all operations when IAP is disabled", async () => {
    process.env.IAP_ENABLED = "false";
    process.env.NEXT_PUBLIC_IAP_ENABLED = "false";

    await expect(
      createCheckoutSession({ userCode: "TEST01", productId: "pro_monthly" }),
    ).rejects.toThrow(/not enabled|disabled/i);

    const { headers, rawBody } = makeSignedWebhook();
    await expect(handleWebhook({ headers, rawBody })).rejects.toThrow(/not enabled|disabled/i);
  });
});
