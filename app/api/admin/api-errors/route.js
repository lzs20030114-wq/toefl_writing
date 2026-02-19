import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";

function jsonError(status, error) {
  return Response.json({ error }, { status });
}

function emptyStats(windowMinutes) {
  return {
    total: 0,
    windowMinutes,
    byStatus: {},
    byType: {},
  };
}

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 100)));
    const status = String(url.searchParams.get("status") || "").trim();
    const errorType = String(url.searchParams.get("errorType") || "").trim();
    const windowMinutes = Math.min(7 * 24 * 60, Math.max(10, Number(url.searchParams.get("minutes") || 24 * 60)));

    let query = supabaseAdmin
      .from("api_error_feedback")
      .select("id,endpoint,stage,http_status,error_type,error_message,error_detail,client_id,client_ip,origin,user_agent,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("http_status", Number(status));
    if (errorType) query = query.eq("error_type", errorType);

    const sinceIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const [{ data: rows, error }, { data: statsRows, error: statsError }] = await Promise.all([
      query,
      supabaseAdmin
        .from("api_error_feedback")
        .select("http_status,error_type,created_at")
        .gte("created_at", sinceIso)
        .limit(2000),
    ]);

    if (error) return jsonError(400, error.message || "List api errors failed");
    if (statsError) return jsonError(400, statsError.message || "Stats query failed");

    const stats = emptyStats(windowMinutes);
    for (const row of statsRows || []) {
      stats.total += 1;
      const statusKey = String(row.http_status || "unknown");
      const typeKey = String(row.error_type || "unknown");
      stats.byStatus[statusKey] = (stats.byStatus[statusKey] || 0) + 1;
      stats.byType[typeKey] = (stats.byType[typeKey] || 0) + 1;
    }

    return Response.json({ rows: rows || [], stats });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
