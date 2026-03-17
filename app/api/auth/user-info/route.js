import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";

const limiter = createRateLimiter("user-info", { max: 20 });

export async function GET(request) {
  try {
    if (limiter.isLimited(getIp(request))) {
      return jsonError(429, "Too many requests. Please try again later.");
    }
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const { searchParams } = new URL(request.url);
    const code = String(searchParams.get("code") || "").toUpperCase().trim();
    if (!code || code.length !== 6) return jsonError(400, "Invalid code");

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("code,email,tier,tier_expires_at,auth_method,status,has_password")
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

    // Mask email to prevent information disclosure (e.g., "john@gmail.com" → "j***n@gmail.com")
    let maskedEmail = null;
    if (user.email) {
      const [local, domain] = user.email.split("@");
      if (local.length <= 2) maskedEmail = local[0] + "***@" + domain;
      else maskedEmail = local[0] + "***" + local[local.length - 1] + "@" + domain;
    }

    return Response.json({
      code: user.code,
      email: maskedEmail,
      tier,
      tier_expires_at: tier === "pro" ? user.tier_expires_at : null,
      auth_method: user.auth_method || "code",
      has_password: user.has_password || false,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
