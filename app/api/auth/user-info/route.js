import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Rate limit: max 20 requests per IP per 60s
const INFO_RL_WINDOW = 60_000;
const INFO_RL_MAX = 20;
const infoBuckets = globalThis.__toeflInfoRLBuckets || new Map();
if (!globalThis.__toeflInfoRLBuckets) globalThis.__toeflInfoRLBuckets = infoBuckets;

function getIp(req) {
  return req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("x-real-ip")
    || "unknown";
}

function isInfoRateLimited(ip) {
  const now = Date.now();
  for (const [k, v] of infoBuckets) { if (now - v.t > INFO_RL_WINDOW) infoBuckets.delete(k); }
  const b = infoBuckets.get(ip);
  if (!b || now - b.t > INFO_RL_WINDOW) { infoBuckets.set(ip, { t: now, c: 1 }); return false; }
  b.c++;
  return b.c > INFO_RL_MAX;
}

function jsonError(status, error) {
  return Response.json({ error }, { status });
}

export async function GET(request) {
  try {
    if (isInfoRateLimited(getIp(request))) {
      return jsonError(429, "Too many requests. Please try again later.");
    }
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
