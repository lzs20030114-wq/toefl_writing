/**
 * 后台付费统计计价 — 2026-08-01 提价分段回填。
 *
 * 背景：iap_entitlements 不存实付金额（2026-08 前），后台营收按
 * product_id × 价目表现算。提价后价目表没跟上，8-01 之后的订单被按
 * 老价计。paidStats 按 created_at 分价格时代，历史订单自动按各自
 * 时代的真实价格计入；metadata.amountCents（实付快照）优先。
 */
import { computePaidStats, entitlementRevenue } from "../lib/iap/paidStats";

const BEFORE = "2026-07-15T10:00:00+00:00"; // 提价前
const AFTER = "2026-08-05T10:00:00+00:00"; // 提价后

function ent(overrides) {
  return { user_code: "U1", provider: "afdian", product_id: "pro_weekly", created_at: AFTER, metadata: {}, ...overrides };
}

describe("entitlementRevenue price eras", () => {
  test("orders before 2026-08-01 price change use legacy CNY prices", () => {
    expect(entitlementRevenue(ent({ product_id: "pro_weekly", created_at: BEFORE }))).toEqual({ currency: "CNY", cents: 999 });
    expect(entitlementRevenue(ent({ product_id: "pro_monthly", created_at: BEFORE }))).toEqual({ currency: "CNY", cents: 2999 });
    expect(entitlementRevenue(ent({ product_id: "pro_quarterly", created_at: BEFORE }))).toEqual({ currency: "CNY", cents: 6997 });
    expect(entitlementRevenue(ent({ product_id: "pro_yearly", created_at: BEFORE }))).toEqual({ currency: "CNY", cents: 25988 });
  });

  test("orders after the price change use 2026-08-01 prices (the backfill fix)", () => {
    expect(entitlementRevenue(ent({ product_id: "pro_weekly" }))).toEqual({ currency: "CNY", cents: 1990 });
    expect(entitlementRevenue(ent({ product_id: "pro_monthly" }))).toEqual({ currency: "CNY", cents: 5990 });
    expect(entitlementRevenue(ent({ product_id: "pro_quarterly" }))).toEqual({ currency: "CNY", cents: 14990 });
    expect(entitlementRevenue(ent({ product_id: "pro_yearly" }))).toEqual({ currency: "CNY", cents: 49990 });
  });

  test("cutoff is the deploy moment 2026-08-01 00:52 +0800", () => {
    expect(entitlementRevenue(ent({ product_id: "pro_monthly", created_at: "2026-08-01T00:51:00+08:00" })).cents).toBe(2999);
    expect(entitlementRevenue(ent({ product_id: "pro_monthly", created_at: "2026-08-01T00:52:00+08:00" })).cents).toBe(5990);
  });

  test("metadata.amountCents (actual paid amount) wins over era tables", () => {
    const rev = entitlementRevenue(ent({ product_id: "pro_monthly", metadata: { amountCents: 11980, currency: "CNY" } }));
    expect(rev).toEqual({ currency: "CNY", cents: 11980 });
  });

  test("xorpay uses the same CNY eras; manual/mock grants count no revenue", () => {
    expect(entitlementRevenue(ent({ provider: "xorpay", product_id: "pro_weekly", created_at: BEFORE })).cents).toBe(999);
    expect(entitlementRevenue(ent({ provider: "admin" }))).toBeNull();
    expect(entitlementRevenue(ent({ provider: "mock" }))).toBeNull();
  });

  test("missing created_at falls back to current prices", () => {
    expect(entitlementRevenue(ent({ product_id: "pro_weekly", created_at: null })).cents).toBe(1990);
  });
});

describe("computePaidStats", () => {
  test("mixed-era orders aggregate at their own era prices", () => {
    const stats = computePaidStats([
      ent({ user_code: "A", product_id: "pro_weekly", created_at: BEFORE }), // 999
      ent({ user_code: "B", product_id: "pro_weekly", created_at: AFTER }), // 1990
      ent({ user_code: "B", product_id: "pro_monthly", created_at: AFTER }), // 5990
      ent({ user_code: "C", provider: "admin", product_id: "pro_weekly" }), // manual, no revenue
    ]);
    expect(stats.real.totalOrders).toBe(3);
    expect(stats.real.uniqueUsers).toBe(2);
    expect(stats.real.revenue).toEqual({ CNY: 999 + 1990 + 5990 });
    expect(stats.real.byProduct.pro_weekly.revenue).toEqual({ CNY: 999 + 1990 });
    expect(stats.real.byProduct.pro_monthly.revenue).toEqual({ CNY: 5990 });
    expect(stats.manual.pureUsers).toBe(1);
    expect(stats.manual.totalOrders).toBe(1);
  });
});
