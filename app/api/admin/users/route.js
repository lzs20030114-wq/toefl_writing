import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";

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

    // Exclude pre-generated pending codes (not yet activated)
    const allUsers = (users || []).filter((u) => u.status !== "pending");
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

    return Response.json({
      total,
      growth: { lastHour, lastDay, lastWeek, lastMonth },
      tiers: tierCounts,
      authMethods: authMethodCounts,
      statuses: statusCounts,
      active: { lastDay: activeLastDay, lastWeek: activeLastWeek, lastMonth: activeLastMonth },
      users: allUsers,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
