import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";

const limiter = createRateLimiter("bind-email", { max: 10 });

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) {
      return jsonError(429, "Too many requests. Please try again later.");
    }
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json();
    const userCode = String(body?.userCode || "").toUpperCase().trim();
    const email = String(body?.email || "").trim().toLowerCase();
    const authUid = String(body?.authUid || "").trim();

    if (!userCode || userCode.length !== 6) return jsonError(400, "Invalid user code");
    if (!email) return jsonError(400, "Email is required");
    if (!authUid) return jsonError(400, "Auth UID is required");

    // Verify authUid is real and matches the claimed email
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(authUid);
    if (authError || !authUser?.user) return jsonError(403, "Invalid auth session");
    if ((authUser.user.email || "").toLowerCase() !== email) {
      return jsonError(403, "Email does not match verified session");
    }

    // Check if email is already used by another account
    const { data: existing } = await supabaseAdmin
      .from("users")
      .select("code")
      .eq("email", email)
      .maybeSingle();

    if (existing && existing.code !== userCode) {
      return jsonError(409, "该邮箱已被其他账户使用");
    }

    // Update the user record
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        email,
        auth_uid: authUid,
        auth_method: "both",
      })
      .eq("code", userCode);

    if (updateError) return jsonError(400, updateError.message || "绑定失败");

    return Response.json({ success: true });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
