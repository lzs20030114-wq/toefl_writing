import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";

const limiter = createRateLimiter("auth", { max: 10 });

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
      return jsonError(429, "Too many attempts. Please try again later.");
    }
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json();
    const code = normalizeCode(body?.code);
    if (!code || code.length !== 6) return jsonError(400, "Invalid code");

    const { data: accessRow, error: accessError } = await supabaseAdmin
      .from("access_codes")
      .select("code,status,expires_at,issued_to")
      .eq("code", code)
      .maybeSingle();

    if (accessError) return jsonError(400, accessError.message || "Access code query failed");

    let effectiveAccess = accessRow;
    if (!effectiveAccess) {
      const { data: legacyUser, error: legacyError } = await supabaseAdmin
        .from("users")
        .select("code,status")
        .eq("code", code)
        .maybeSingle();
      if (legacyError) return jsonError(400, legacyError.message || "Legacy user query failed");
      if (!legacyUser?.code) return jsonError(401, "Invalid code");

      const issuedAt = new Date().toISOString();
      const { data: migratedAccess, error: migrateError } = await supabaseAdmin
        .from("access_codes")
        .upsert(
          { code, status: "issued", issued_to: "legacy-user", issued_at: issuedAt, expires_at: null },
          { onConflict: "code" }
        )
        .select("code,status,expires_at,issued_to")
        .single();
      if (migrateError) return jsonError(400, migrateError.message || "Legacy code activation failed");
      effectiveAccess = migratedAccess;
    }

    if (String(effectiveAccess.status || "") !== "issued") return jsonError(401, "Code not active");
    if (isExpired(effectiveAccess.expires_at)) return jsonError(401, "Code expired");

    const now = new Date().toISOString();

    // Fetch user record for tier/status info
    const { data: userRow } = await supabaseAdmin
      .from("users")
      .select("code,email,tier,tier_expires_at,auth_method,status,has_password")
      .eq("code", code)
      .maybeSingle();

    // Handle pending code activation (pre-generated codes for sale)
    if (userRow?.status === "pending") {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await supabaseAdmin
        .from("users")
        .update({
          status: "active",
          last_login: now,
          tier_expires_at: expiresAt.toISOString(),
        })
        .eq("code", code);

      return Response.json({
        valid: true,
        error: null,
        code,
        tier: userRow.tier || "pro",
        email: userRow.email || null,
        auth_method: userRow.auth_method || "code",
        has_password: userRow.has_password || false,
        pro_trial: await safeGetProTrial(code),
      });
    }

    // Check if pro tier has expired
    let tier = userRow?.tier || "free";

    // Legacy users (existed before payment system) get legacy tier with pro-level access
    if (tier !== "pro" && tier !== "legacy" && effectiveAccess?.issued_to === "legacy-user") {
      tier = "legacy";
      await supabaseAdmin.from("users").update({ tier: "legacy" }).eq("code", code);
    }

    if (tier === "pro" && userRow?.tier_expires_at && isExpired(userRow.tier_expires_at)) {
      tier = "free";
      await supabaseAdmin
        .from("users")
        .update({ tier: "free", tier_expires_at: null, last_login: now })
        .eq("code", code);
    } else {
      // Normal active code: upsert user + update last_login
      const { error: userUpsertError } = await supabaseAdmin
        .from("users")
        .upsert({ code, last_login: now }, { onConflict: "code" });
      if (userUpsertError) return jsonError(400, userUpsertError.message || "User sync failed");
    }

    return Response.json({
      valid: true,
      error: null,
      code,
      tier,
      email: userRow?.email || null,
      auth_method: userRow?.auth_method || "code",
      has_password: userRow?.has_password || false,
      pro_trial: await safeGetProTrial(code),
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
