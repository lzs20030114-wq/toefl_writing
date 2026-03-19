import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";
import { jsonError } from "../../../../lib/apiResponse";

const limiter = createRateLimiter("email-login", { max: 10 });

const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

// Safely read pro_trial flag (column may not exist before migration)
async function safeGetProTrial(userCode) {
  try {
    const { data } = await supabaseAdmin.from("users").select("pro_trial").eq("code", userCode).maybeSingle();
    return data?.pro_trial || false;
  } catch { return false; }
}

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) {
      return jsonError(429, "Too many requests. Please try again later.");
    }
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const authUid = String(body?.authUid || "").trim();

    if (!email) return jsonError(400, "Email is required");
    if (!authUid) return jsonError(400, "Auth UID is required");

    // Verify authUid is real and email matches the authenticated user
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(authUid);
    if (authError || !authUser?.user) return jsonError(401, "Invalid auth session");
    if ((authUser.user.email || "").toLowerCase() !== email) {
      return jsonError(403, "Email does not match verified session");
    }

    // Check if user already exists with this email
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("code,email,tier,tier_expires_at,auth_method,has_password")
      .eq("email", email)
      .maybeSingle();

    if (existingUser) {
      // Existing user — update auth_uid and last_login
      const now = new Date().toISOString();
      await supabaseAdmin
        .from("users")
        .update({ auth_uid: authUid, last_login: now })
        .eq("code", existingUser.code);

      // Check if pro tier expired
      let tier = existingUser.tier || "free";
      if (tier === "pro" && existingUser.tier_expires_at) {
        const expiresAt = new Date(existingUser.tier_expires_at).getTime();
        if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
          tier = "free";
          await supabaseAdmin
            .from("users")
            .update({ tier: "free", tier_expires_at: null })
            .eq("code", existingUser.code);
        }
      }

      return Response.json({
        code: existingUser.code,
        email,
        tier,
        auth_method: existingUser.auth_method || "email",
        has_password: existingUser.has_password || false,
        pro_trial: await safeGetProTrial(existingUser.code),
        isNewUser: false,
      });
    }

    // Also check by auth_uid (in case email was changed)
    const { data: uidUser } = await supabaseAdmin
      .from("users")
      .select("code,email,tier,auth_method,has_password")
      .eq("auth_uid", authUid)
      .maybeSingle();

    if (uidUser) {
      const now = new Date().toISOString();
      await supabaseAdmin
        .from("users")
        .update({ email, last_login: now })
        .eq("code", uidUser.code);

      return Response.json({
        code: uidUser.code,
        email,
        tier: uidUser.tier || "free",
        auth_method: uidUser.auth_method || "email",
        has_password: uidUser.has_password || false,
        pro_trial: await safeGetProTrial(uidUser.code),
        isNewUser: false,
      });
    }

    // New user: generate internal code + grant 3-day Pro trial
    const now = new Date().toISOString();
    const trialExpiry = new Date();
    trialExpiry.setDate(trialExpiry.getDate() + 3);
    let newCode = null;

    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateCode();
      const { error: insertError } = await supabaseAdmin
        .from("users")
        .insert({
          code,
          email,
          auth_uid: authUid,
          status: "active",
          auth_method: "email",
          tier: "pro",
          tier_expires_at: trialExpiry.toISOString(),
          last_login: now,
        });

      if (!insertError) {
        newCode = code;
        // Best-effort: mark as pro trial (column may not exist yet)
        try { await supabaseAdmin.from("users").update({ pro_trial: true }).eq("code", code); } catch {}
        break;
      }
      // Duplicate code, retry
      if (insertError.code === "23505" && insertError.message?.includes("code")) continue;
      return jsonError(400, insertError.message || "Failed to create user");
    }

    if (!newCode) return jsonError(500, "Failed to generate unique code");

    // Also create access_codes entry for the new user
    await supabaseAdmin
      .from("access_codes")
      .upsert(
        { code: newCode, status: "issued", issued_to: email, issued_at: now, expires_at: null },
        { onConflict: "code" }
      );

    return Response.json({
      code: newCode,
      email,
      tier: "pro",
      auth_method: "email",
      has_password: false,
      pro_trial: true,
      isNewUser: true,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
