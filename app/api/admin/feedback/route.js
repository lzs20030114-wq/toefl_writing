import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";

function jsonError(status, error) {
  return Response.json({ error }, { status });
}

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
    const userCode = String(url.searchParams.get("userCode") || "").trim().toUpperCase();

    let query = supabaseAdmin
      .from("user_feedback")
      .select("id,user_code,content,page,origin,user_agent,client_ip,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (userCode) query = query.eq("user_code", userCode);

    const { data, error } = await query;
    if (error) return jsonError(400, error.message || "List feedback failed");

    return Response.json({
      rows: data || [],
      stats: {
        total: Array.isArray(data) ? data.length : 0,
      },
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
