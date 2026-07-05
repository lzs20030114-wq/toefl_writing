/**
 * @jest-environment node
 *
 * XorPay webhook 金额对账 + 发权益顺序 测试
 *
 * 覆盖两个已确认的钱相关 bug：
 *  1. 金额对账：webhook 回调的 pay_price 必须等于 catalog 中商品价格，
 *     否则拒绝发权益（防止「付 ¥0.01 拿年卡」）。
 *  2. 发权益顺序：先授予权益成功、再标记 webhook 已处理。
 *     若授予中途失败，事件不能被标记为已处理，provider 重试可再次授予。
 */

import { createHash } from "crypto";

// Wrap the real repository so tests can force grantEntitlement to fail once,
// exercising the grant-then-mark ordering. All other exports pass through.
let __forceGrantError = null; // set to an Error to make the NEXT grant throw
jest.mock("../lib/iap/repository", () => {
  const actual = jest.requireActual("../lib/iap/repository");
  return {
    ...actual,
    grantEntitlement: jest.fn((...args) => {
      if (__forceGrantError) {
        const err = __forceGrantError;
        __forceGrantError = null; // one-shot
        return Promise.reject(err);
      }
      return actual.grantEntitlement(...args);
    }),
  };
});

const APP_SECRET = "test_app_secret_xorpay";

function md5(str) {
  return createHash("md5").update(str).digest("hex");
}

/**
 * 构造一个签名合法的 XorPay webhook 表单体。
 * 签名口径：MD5(aoid + order_id + pay_price + pay_time + app_secret)
 * more 字段携带 userCode + productId（与 checkout 侧一致）。
 */
function buildSignedXorpayBody({ aoid, orderId, payPrice, payTime = "2026-07-05 12:00:00", userCode, productId }) {
  const sign = md5(aoid + orderId + payPrice + payTime + APP_SECRET);
  const params = new URLSearchParams({
    aoid,
    order_id: orderId,
    pay_price: payPrice,
    pay_time: payTime,
    sign,
    more: JSON.stringify({ userCode, productId }),
  });
  return params.toString();
}

describe("XorPay webhook 金额对账 + 发权益顺序", () => {
  const OLD_ENV = process.env;
  let handleWebhook;
  let getUserEntitlements;
  let isWebhookEventProcessed;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...OLD_ENV,
      IAP_ENABLED: "true",
      NEXT_PUBLIC_IAP_ENABLED: "true",
      IAP_PROVIDER: "xorpay",
      XORPAY_APP_SECRET: APP_SECRET,
    };
    globalThis.__iapStore = undefined;
    // require after env + resetModules so provider picks up XORPAY_APP_SECRET
    ({ handleWebhook, getUserEntitlements } = require("../lib/iap/service"));
    ({ isWebhookEventProcessed } = require("../lib/iap/repository"));
  });

  afterEach(() => {
    process.env = OLD_ENV;
    globalThis.__iapStore = undefined;
    __forceGrantError = null;
    jest.restoreAllMocks();
  });

  const headers = new Headers();

  // ── 1. 金额对账 ──────────────────────────────────────────

  test("正确金额（¥259.88 年卡）→ 授予权益", async () => {
    const rawBody = buildSignedXorpayBody({
      aoid: "ao_ok_year",
      orderId: "xp_ok_year",
      payPrice: "259.88", // pro_yearly = 25988 cents
      userCode: "USER01",
      productId: "pro_yearly",
    });

    const result = await handleWebhook({ headers, rawBody });
    expect(result.ok).toBe(true);
    expect(result.granted).toBe(true);
    expect(result.entitlement.productId).toBe("pro_yearly");

    const ents = await getUserEntitlements("USER01");
    expect(ents).toHaveLength(1);
  });

  test("欠费金额（付 ¥0.01 想拿年卡）→ 拒绝 + 不发权益", async () => {
    const rawBody = buildSignedXorpayBody({
      aoid: "ao_underpay",
      orderId: "xp_underpay",
      payPrice: "0.01", // way below pro_yearly 259.88
      userCode: "USER02",
      productId: "pro_yearly",
    });

    await expect(handleWebhook({ headers, rawBody })).rejects.toThrow(/mismatch|amount/i);

    // 未发权益
    const ents = await getUserEntitlements("USER02");
    expect(ents).toHaveLength(0);
    // 事件未被标记已处理 → 允许（如果日后金额修正）重试
    expect(await isWebhookEventProcessed("xorpay", "ao_underpay")).toBe(false);
  });

  test("少付一分钱（¥259.87 vs ¥259.88）→ 拒绝（无折扣容差）", async () => {
    const rawBody = buildSignedXorpayBody({
      aoid: "ao_short1",
      orderId: "xp_short1",
      payPrice: "259.87",
      userCode: "USER03",
      productId: "pro_yearly",
    });

    await expect(handleWebhook({ headers, rawBody })).rejects.toThrow(/mismatch|amount/i);
    const ents = await getUserEntitlements("USER03");
    expect(ents).toHaveLength(0);
  });

  test("多付（¥300 买年卡）→ 接受（用户吃亏，不拦）", async () => {
    const rawBody = buildSignedXorpayBody({
      aoid: "ao_overpay",
      orderId: "xp_overpay",
      payPrice: "300.00",
      userCode: "USER04",
      productId: "pro_yearly",
    });

    const result = await handleWebhook({ headers, rawBody });
    expect(result.granted).toBe(true);
  });

  test("拿便宜商品的钱套贵商品的天数（付月卡钱 ¥29.99 领年卡）→ 拒绝", async () => {
    const rawBody = buildSignedXorpayBody({
      aoid: "ao_swap",
      orderId: "xp_swap",
      payPrice: "29.99", // pro_monthly price
      userCode: "USER05",
      productId: "pro_yearly", // but claims yearly
    });

    await expect(handleWebhook({ headers, rawBody })).rejects.toThrow(/mismatch|amount/i);
    const ents = await getUserEntitlements("USER05");
    expect(ents).toHaveLength(0);
  });

  // ── 2. 发权益顺序（grant-then-mark）────────────────────────

  test("授予权益失败 → 事件不标记已处理 → 重试可成功", async () => {
    // 让第一次 grantEntitlement 抛错，模拟 DB 中途失败
    __forceGrantError = new Error("transient DB failure");

    const rawBody = buildSignedXorpayBody({
      aoid: "ao_retry",
      orderId: "xp_retry",
      payPrice: "29.99",
      userCode: "USER06",
      productId: "pro_monthly",
    });

    // 第一次：grant 抛错 → handleWebhook 冒泡异常
    await expect(handleWebhook({ headers, rawBody })).rejects.toThrow(/transient/i);
    // 关键：事件未被标记已处理
    expect(await isWebhookEventProcessed("xorpay", "ao_retry")).toBe(false);

    // 第二次（provider 重试）：grant 恢复正常 → 成功授予
    const result = await handleWebhook({ headers, rawBody });
    expect(result.granted).toBe(true);
    const ents = await getUserEntitlements("USER06");
    expect(ents).toHaveLength(1);
    // 现在才标记已处理
    expect(await isWebhookEventProcessed("xorpay", "ao_retry")).toBe(true);
  });

  test("同一事件重复回调 → 去重（第二次 duplicate:true，不重复发权益）", async () => {
    const rawBody = buildSignedXorpayBody({
      aoid: "ao_dup",
      orderId: "xp_dup",
      payPrice: "9.99",
      userCode: "USER07",
      productId: "pro_weekly",
    });

    const first = await handleWebhook({ headers, rawBody });
    expect(first.granted).toBe(true);

    const second = await handleWebhook({ headers, rawBody });
    expect(second.duplicate).toBe(true);
    expect(second.granted).toBeUndefined();

    const ents = await getUserEntitlements("USER07");
    expect(ents).toHaveLength(1); // 只发一次
  });
});
