import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";

const MANUAL_PROVIDERS = new Set(["admin", "mock"]);

const PRICE_CNY_CENTS = {
  pro_weekly: 999,
  pro_monthly: 2999,
  pro_quarterly: 6997,
  pro_yearly: 25988,
};
const PRICE_USD_CENTS = {
  pro_monthly: 990,
  pro_yearly: 7990,
};

function entitlementRevenue(provider, productId) {
  if (MANUAL_PROVIDERS.has(provider)) return null;
  if (provider === "xorpay" || provider === "afdian") {
    const cents = PRICE_CNY_CENTS[productId];
    return cents ? { currency: "CNY", cents } : null;
  }
  const cents = PRICE_USD_CENTS[productId];
  return cents ? { currency: "USD", cents } : null;
}

function addRevenue(target, rev) {
  if (!rev) return;
  target[rev.currency] = (target[rev.currency] || 0) + rev.cents;
}

function computePaidStats(ents) {
  const realEnts = ents.filter((e) => !MANUAL_PROVIDERS.has(e.provider));
  const manualEnts = ents.filter((e) => MANUAL_PROVIDERS.has(e.provider));

  const realUsers = new Set(realEnts.map((e) => e.user_code));
  const manualUsersAll = new Set(manualEnts.map((e) => e.user_code));
  const pureManualUsers = [...manualUsersAll].filter((u) => !realUsers.has(u));

  const realRevenue = {};
  const byProvider = {};
  const byProduct = {};
  for (const e of realEnts) {
    const rev = entitlementRevenue(e.provider, e.product_id);
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

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const now = new Date();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all users
    const { data: users, error } = await supabaseAdmin
      .from("users")
      .select("code,email,tier,tier_expires_at,auth_method,status,created_at,last_login")
      .order("created_at", { ascending: false });

    if (error) return jsonError(400, error.message || "Query failed");

    // Find pre-generated codes to exclude from user list
    const { data: pregenCodes } = await supabaseAdmin
      .from("access_codes")
      .select("code")
      .eq("issued_to", "pre-generated");
    const pregenSet = new Set((pregenCodes || []).map((r) => r.code));

    // Exclude only pre-generated pending users (not yet activated by login)
    const allUsers = (users || []).filter((u) => !(pregenSet.has(u.code) && u.status === "pending"));
    const total = allUsers.length;

    // Count new users by time range
    let lastHour = 0, lastDay = 0, lastWeek = 0, lastMonth = 0;
    // Count by tier
    const tierCounts = { free: 0, pro: 0, legacy: 0, unknown: 0 };
    // Count by auth method
    const authMethodCounts = { code: 0, email: 0, unknown: 0 };
    // Count by status
    const statusCounts = { active: 0, inactive: 0, unknown: 0 };
    // Active users (logged in within time ranges)
    let activeLastDay = 0, activeLastWeek = 0, activeLastMonth = 0;

    for (const u of allUsers) {
      const createdAt = u.created_at || "";
      if (createdAt >= oneHourAgo) lastHour++;
      if (createdAt >= oneDayAgo) lastDay++;
      if (createdAt >= oneWeekAgo) lastWeek++;
      if (createdAt >= oneMonthAgo) lastMonth++;

      // Tier
      const tier = String(u.tier || "free").toLowerCase();
      if (tier === "pro") {
        const expires = u.tier_expires_at;
        if (expires && new Date(expires) > now) {
          tierCounts.pro++;
        } else {
          tierCounts.free++;
        }
      } else {
        tierCounts[tier] !== undefined ? tierCounts[tier]++ : tierCounts.unknown++;
      }

      // Auth method
      const am = String(u.auth_method || "").toLowerCase();
      if (am === "email") authMethodCounts.email++;
      else if (am === "code" || am === "") authMethodCounts.code++;
      else authMethodCounts.unknown++;

      // Status
      const st = String(u.status || "").toLowerCase();
      if (st === "active") statusCounts.active++;
      else if (st === "inactive" || st === "suspended") statusCounts.inactive++;
      else statusCounts.unknown++;

      // Active users by last_login
      const lastLogin = u.last_login || "";
      if (lastLogin >= oneDayAgo) activeLastDay++;
      if (lastLogin >= oneWeekAgo) activeLastWeek++;
      if (lastLogin >= oneMonthAgo) activeLastMonth++;
    }

    // Paid user stats from iap_entitlements
    const { data: entitlements } = await supabaseAdmin
      .from("iap_entitlements")
      .select("user_code,product_id,provider,created_at");
    const ents = entitlements || [];
    const paidStats = computePaidStats(ents);

    return Response.json({
      total,
      growth: { lastHour, lastDay, lastWeek, lastMonth },
      tiers: tierCounts,
      authMethods: authMethodCounts,
      statuses: statusCounts,
      active: { lastDay: activeLastDay, lastWeek: activeLastWeek, lastMonth: activeLastMonth },
      paid: paidStats,
      users: allUsers,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
