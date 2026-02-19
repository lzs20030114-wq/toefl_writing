import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";

function jsonError(status, error) {
  return Response.json({ valid: false, error }, { status });
}

function normalizeCode(code) {
  return String(code || "").toUpperCase().trim();
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= Date.now();
}

export async function POST(request) {
  try {
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json();
    const code = normalizeCode(body?.code);
    if (!code || code.length !== 6) return jsonError(400, "Invalid code");

    const { data: accessRow, error: accessError } = await supabaseAdmin
      .from("access_codes")
      .select("code,status,expires_at")
      .eq("code", code)
      .single();

    if (accessError || !accessRow) return jsonError(401, "Invalid code");
    if (String(accessRow.status || "") !== "issued") return jsonError(401, "Code not active");
    if (isExpired(accessRow.expires_at)) return jsonError(401, "Code expired");

    const now = new Date().toISOString();
    const { error: userUpsertError } = await supabaseAdmin
      .from("users")
      .upsert({ code, last_login: now }, { onConflict: "code" });
    if (userUpsertError) return jsonError(400, userUpsertError.message || "User sync failed");

    await supabaseAdmin.from("users").update({ last_login: now }).eq("code", code);

    return Response.json({ valid: true, error: null, code });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

