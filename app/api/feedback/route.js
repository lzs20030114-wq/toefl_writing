import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";

function jsonError(status, error) {
  return Response.json({ error }, { status });
}

function parseIp(request) {
  const forwarded = String(request.headers.get("x-forwarded-for") || "").trim();
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = String(request.headers.get("x-real-ip") || "").trim();
  return realIp || null;
}

export async function POST(request) {
  try {
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json().catch(() => ({}));
    const userCode = String(body?.userCode || "").trim().toUpperCase();
    const content = String(body?.content || "").trim();
    const page = String(body?.page || "").trim().slice(0, 120) || "/";

    if (!userCode) return jsonError(400, "Missing userCode");
    if (!content) return jsonError(400, "Feedback content is required");
    if (content.length > 2000) return jsonError(400, "Feedback content is too long");

    const record = {
      user_code: userCode,
      content,
      page,
      origin: String(request.headers.get("origin") || "").slice(0, 200) || null,
      user_agent: String(request.headers.get("user-agent") || "").slice(0, 400) || null,
      client_ip: parseIp(request),
    };

    const { error } = await supabaseAdmin.from("user_feedback").insert(record);
    if (error) return jsonError(400, error.message || "Insert feedback failed");

    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
