import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get("days")) || 30, 1), 90);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // Fetch page views within range
    const { data: rows, error } = await supabaseAdmin
      .from("page_views")
      .select("path,referrer,user_code,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50000);

    if (error) return jsonError(400, error.message);

    const views = rows || [];
    const total = views.length;

    // Daily PV counts
    const dailyMap = {};
    // Top pages
    const pageMap = {};
    // Top referrers
    const refMap = {};
    // Unique visitors (by user_code, null = anonymous)
    const uniqueUsers = new Set();
    let anonymous = 0;

    for (const v of views) {
      // Daily
      const day = v.created_at.slice(0, 10);
      dailyMap[day] = (dailyMap[day] || 0) + 1;

      // Pages
      pageMap[v.path] = (pageMap[v.path] || 0) + 1;

      // Referrers
      if (v.referrer) {
        try {
          const host = new URL(v.referrer).hostname;
          refMap[host] = (refMap[host] || 0) + 1;
        } catch { /* ignore */ }
      }

      // Unique
      if (v.user_code) uniqueUsers.add(v.user_code);
      else anonymous++;
    }

    // Sort daily by date
    const daily = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // Top 20 pages
    const topPages = Object.entries(pageMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([path, count]) => ({ path, count }));

    // Top 10 referrers
    const topReferrers = Object.entries(refMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([host, count]) => ({ host, count }));

    // Today's stats
    const today = new Date().toISOString().slice(0, 10);
    const todayPV = dailyMap[today] || 0;

    return Response.json({
      days,
      total,
      todayPV,
      uniqueUsers: uniqueUsers.size,
      anonymous,
      daily,
      topPages,
      topReferrers,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
