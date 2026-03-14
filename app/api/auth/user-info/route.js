import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";

function jsonError(status, error) {
  return Response.json({ error }, { status });
}

export async function GET(request) {
  try {
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const { searchParams } = new URL(request.url);
    const code = String(searchParams.get("code") || "").toUpperCase().trim();
    if (!code || code.length !== 6) return jsonError(400, "Invalid code");

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("code,email,tier,tier_expires_at,auth_method,status")
      .eq("code", code)
      .maybeSingle();

    if (error) return jsonError(400, error.message);
    if (!user) return jsonError(404, "User not found");

    // Check pro expiration
    let tier = user.tier || "free";
    if (tier === "pro" && user.tier_expires_at) {
      const expiresAt = new Date(user.tier_expires_at).getTime();
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        tier = "free";
        await supabaseAdmin
          .from("users")
          .update({ tier: "free", tier_expires_at: null })
          .eq("code", code);
      }
    }

    return Response.json({
      code: user.code,
      email: user.email || null,
      tier,
      tier_expires_at: tier === "pro" ? user.tier_expires_at : null,
      auth_method: user.auth_method || "code",
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
