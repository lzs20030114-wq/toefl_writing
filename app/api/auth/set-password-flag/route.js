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

    const body = await request.json();
    const authUid = String(body?.authUid || "").trim();
    if (!authUid) return jsonError(400, "Auth UID is required");

    // Verify the auth user exists
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(authUid);
    if (authError || !authUser?.user) return jsonError(401, "Invalid auth user");

    // Set has_password = true on the matching users row
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ has_password: true })
      .eq("auth_uid", authUid);

    if (updateError) return jsonError(400, updateError.message || "Failed to update password flag");

    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
