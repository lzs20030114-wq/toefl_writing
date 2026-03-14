import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Rate limit: max 10 req/IP/60s
const EMAIL_RL_WINDOW = 60_000;
const EMAIL_RL_MAX = 10;
const emailBuckets = globalThis.__toeflEmailRLBuckets || new Map();
if (!globalThis.__toeflEmailRLBuckets) globalThis.__toeflEmailRLBuckets = emailBuckets;

function getIp(req) {
  return req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("x-real-ip")
    || "unknown";
}

function isEmailRateLimited(ip) {
  const now = Date.now();
  for (const [k, v] of emailBuckets) { if (now - v.t > EMAIL_RL_WINDOW) emailBuckets.delete(k); }
  const b = emailBuckets.get(ip);
  if (!b || now - b.t > EMAIL_RL_WINDOW) { emailBuckets.set(ip, { t: now, c: 1 }); return false; }
  b.c++;
  return b.c > EMAIL_RL_MAX;
}

function jsonError(status, error) {
  return Response.json({ error }, { status });
}

const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

export async function POST(request) {
  try {
    if (isEmailRateLimited(getIp(request))) {
      return jsonError(429, "Too many requests. Please try again later.");
    }
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const authUid = String(body?.authUid || "").trim();

    if (!email) return jsonError(400, "Email is required");
    if (!authUid) return jsonError(400, "Auth UID is required");

    // Check if user already exists with this email
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("code,email,tier,tier_expires_at,auth_method")
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
        isNewUser: false,
      });
    }

    // Also check by auth_uid (in case email was changed)
    const { data: uidUser } = await supabaseAdmin
      .from("users")
      .select("code,email,tier,auth_method")
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
        isNewUser: false,
      });
    }

    // New user: generate internal code
    const now = new Date().toISOString();
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
          tier: "free",
          last_login: now,
        });

      if (!insertError) {
        newCode = code;
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
      tier: "free",
      auth_method: "email",
      isNewUser: true,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
