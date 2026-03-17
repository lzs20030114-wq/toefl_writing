import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";

const limiter = createRateLimiter("set-pwd-flag", { max: 10 });

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) {
      return jsonError(429, "Too many requests. Please try again later.");
    }
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    // Extract and verify Supabase access token from Authorization header
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonError(401, "Missing authorization token");

    const { data: { user }, error: tokenError } = await supabaseAdmin.auth.getUser(token);
    if (tokenError || !user?.id) return jsonError(401, "Invalid or expired token");

    // Set has_password = true on the matching users row
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ has_password: true })
      .eq("auth_uid", user.id);

    if (updateError) return jsonError(400, updateError.message || "Failed to update password flag");

    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
