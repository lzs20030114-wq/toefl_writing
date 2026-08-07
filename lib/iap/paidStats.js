// 付费统计计价（后台 /admin-users 「付费统计」卡片用）。
//
// 营收优先取 entitlement.metadata.amountCents（webhook 实付金额，2026-08 起
// 由 lib/iap/service.js 入账时写入）；没有实付记录的历史订单按 created_at
// 落在哪个价格时代查对应价目表。以后调价只需在 PRICE_ERAS_CNY 追加一段。

export const MANUAL_PROVIDERS = new Set(["admin", "mock"]);

// 价格时代按生效时间倒序排列，取第一个 startAt <= created_at 的档。
// 2026-08-01 提价随 commit 6804b14 于北京时间 00:52 部署生效；
// 之前的订单只可能按老价支付。
export const PRICE_ERAS_CNY = [
  {
    startAt: Date.parse("2026-07-31T16:52:00Z"), // 2026-08-01 00:52 +0800
    cents: {
      pro_weekly: 1990,
      pro_monthly: 5990,
      pro_quarterly: 14990,
      pro_yearly: 49990,
    },
  },
  {
    startAt: -Infinity,
    cents: {
      pro_weekly: 999,
      pro_monthly: 2999,
      pro_quarterly: 6997,
      pro_yearly: 25988,
    },
  },
];

const PRICE_USD_CENTS = {
  pro_monthly: 990,
  pro_yearly: 7990,
};

function cnyPriceAt(productId, createdAt) {
  const ts = Date.parse(createdAt || "");
  // created_at 缺失/非法时按当前价计（表有 default now()，正常不会走到）。
  const at = Number.isFinite(ts) ? ts : Infinity;
  const era = PRICE_ERAS_CNY.find((e) => e.startAt <= at) || PRICE_ERAS_CNY[PRICE_ERAS_CNY.length - 1];
  return era.cents[productId] || null;
}

export function entitlementRevenue(ent) {
  const provider = ent?.provider;
  if (MANUAL_PROVIDERS.has(provider)) return null;

  const metaCents = Number(ent?.metadata?.amountCents);
  if (Number.isInteger(metaCents) && metaCents > 0) {
    const currency = String(ent?.metadata?.currency || "CNY").trim().toUpperCase();
    return { currency, cents: metaCents };
  }

  if (provider === "xorpay" || provider === "afdian") {
    const cents = cnyPriceAt(ent?.product_id, ent?.created_at);
    return cents ? { currency: "CNY", cents } : null;
  }
  const cents = PRICE_USD_CENTS[ent?.product_id];
  return cents ? { currency: "USD", cents } : null;
}

function addRevenue(target, rev) {
  if (!rev) return;
  target[rev.currency] = (target[rev.currency] || 0) + rev.cents;
}

export function computePaidStats(ents) {
  const realEnts = ents.filter((e) => !MANUAL_PROVIDERS.has(e.provider));
  const manualEnts = ents.filter((e) => MANUAL_PROVIDERS.has(e.provider));

  const realUsers = new Set(realEnts.map((e) => e.user_code));
  const manualUsersAll = new Set(manualEnts.map((e) => e.user_code));
  const pureManualUsers = [...manualUsersAll].filter((u) => !realUsers.has(u));

  const realRevenue = {};
  const byProvider = {};
  const byProduct = {};
  for (const e of realEnts) {
    const rev = entitlementRevenue(e);
    addRevenue(realRevenue, rev);

    const p = e.provider || "unknown";
    if (!byProvider[p]) byProvider[p] = { orders: 0, _users: new Set(), revenue: {} };
    byProvider[p].orders += 1;
    byProvider[p]._users.add(e.user_code);
    addRevenue(byProvider[p].revenue, rev);

    const pid = e.product_id || "unknown";
    if (!byProduct[pid]) byProduct[pid] = { orders: 0, _users: new Set(), revenue: {} };
    byProduct[pid].orders += 1;
    byProduct[pid]._users.add(e.user_code);
    addRevenue(byProduct[pid].revenue, rev);
  }
  const byProviderOut = {};
  for (const [k, v] of Object.entries(byProvider)) {
    byProviderOut[k] = { orders: v.orders, users: v._users.size, revenue: v.revenue };
  }
  const byProductOut = {};
  for (const [k, v] of Object.entries(byProduct)) {
    byProductOut[k] = { orders: v.orders, users: v._users.size, revenue: v.revenue };
  }

  const manualByProduct = {};
  for (const e of manualEnts) {
    const pid = e.product_id || "unknown";
    manualByProduct[pid] = (manualByProduct[pid] || 0) + 1;
  }

  return {
    // Backward compat
    totalOrders: ents.length,
    uniqueUsers: new Set(ents.map((e) => e.user_code)).size,

    // New structured breakdown
    real: {
      uniqueUsers: realUsers.size,
      totalOrders: realEnts.length,
      revenue: realRevenue,
      byProvider: byProviderOut,
      byProduct: byProductOut,
    },
    manual: {
      pureUsers: pureManualUsers.length,
      totalOrders: manualEnts.length,
      byProduct: manualByProduct,
    },
  };
}
