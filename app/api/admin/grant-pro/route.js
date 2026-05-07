import { randomUUID } from "crypto";
import { isAdminAuthorized } from "../../../../lib/adminAuth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { jsonError } from "../../../../lib/apiResponse";

const MAX_DAYS = 3650;

function normalizeIdentifier(raw) {
  const s = String(raw || "").trim();
  if (!s) return { kind: null, value: "" };
  // 6-char alphanumeric code (uppercase) — match the access_code shape.
  if (/^[A-Za-z0-9]{6}$/.test(s)) {
    return { kind: "code", value: s.toUpperCase() };
  }
  if (s.includes("@")) return { kind: "email", value: s.toLowerCase() };
  // Fallback: also try as code if uppercased matches the alphabet
  return { kind: "unknown", value: s };
}

async function findUser(identifier) {
  const { kind, value } = normalizeIdentifier(identifier);
  if (!value) return { error: "Missing identifier" };

  if (kind === "code") {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("code,email,tier,tier_expires_at,status,created_at,last_login")
      .eq("code", value)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: `Code ${value} not found` };
    return { user: data };
  }
  if (kind === "email") {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("code,email,tier,tier_expires_at,status,created_at,last_login")
      .eq("email", value)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: `Email ${value} not found` };
    return { user: data };
  }
  return { error: `Unrecognized identifier "${value}" (use 6-char code or email)` };
}

export async function GET(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const url = new URL(request.url);
    const lookup = String(url.searchParams.get("lookup") || "").trim();
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));

    // Lookup branch — used by the page to preview a user before granting.
    if (lookup) {
      const result = await findUser(lookup);
      if (result.error) return jsonError(404, result.error);
      return Response.json({ ok: true, user: result.user });
    }

    // Recent admin grants (with joined user email)
    const { data: grants, error } = await supabaseAdmin
      .from("iap_entitlements")
      .select("id,user_code,product_id,provider,provider_ref,granted_at,metadata")
      .eq("provider", "admin")
      .order("granted_at", { ascending: false })
      .limit(limit);
    if (error) return jsonError(400, error.message || "List grants failed");

    const codes = [...new Set((grants || []).map((g) => g.user_code).filter(Boolean))];
    let usersByCode = {};
    if (codes.length > 0) {
      const { data: users } = await supabaseAdmin
        .from("users")
        .select("code,email,tier,tier_expires_at")
        .in("code", codes);
      for (const u of users || []) usersByCode[u.code] = u;
    }

    const enriched = (grants || []).map((g) => ({
      id: g.id,
      user_code: g.user_code,
      user_email: usersByCode[g.user_code]?.email || null,
      user_tier: usersByCode[g.user_code]?.tier || null,
      user_tier_expires_at: usersByCode[g.user_code]?.tier_expires_at || null,
      product_id: g.product_id,
      granted_at: g.granted_at,
      provider_ref: g.provider_ref,
      days: Number(g.metadata?.days) || null,
      reason: String(g.metadata?.reason || ""),
      granted_by: String(g.metadata?.grantedBy || ""),
    }));

    return Response.json({ ok: true, grants: enriched });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

export async function POST(request) {
  try {
    if (!isAdminAuthorized(request)) return jsonError(401, "Unauthorized");
    if (!isSupabaseAdminConfigured) return jsonError(503, "Supabase admin is not configured");

    const body = await request.json().catch(() => ({}));
    const days = Math.floor(Number(body?.days));
    if (!Number.isFinite(days) || days <= 0 || days > MAX_DAYS) {
      return jsonError(400, `Invalid days (must be 1..${MAX_DAYS})`);
    }
    const reason = String(body?.reason || "").slice(0, 200);
    const identifier = String(body?.identifier || "").trim();
    if (!identifier) return jsonError(400, "Missing identifier (code or email)");

    const result = await findUser(identifier);
    if (result.error) return jsonError(404, result.error);
    const user = result.user;

    // Stack on top of existing pro expiry if still active
    const now = new Date();
    let baseDate = now;
    if (user.tier === "pro" && user.tier_expires_at) {
      const cur = new Date(user.tier_expires_at);
      if (cur > now) baseDate = cur;
    }
    const expiresAt = new Date(baseDate);
    expiresAt.setDate(expiresAt.getDate() + days);

    // Update tier
    const { error: updateErr } = await supabaseAdmin
      .from("users")
      .update({ tier: "pro", tier_expires_at: expiresAt.toISOString() })
      .eq("code", user.code);
    if (updateErr) return jsonError(400, `Update tier failed: ${updateErr.message}`);

    // Insert entitlement record (mirrors scripts/grant-pro.mjs shape)
    const productId = days >= 365 ? "pro_yearly"
      : days >= 90 ? "pro_quarterly"
      : days >= 30 ? "pro_monthly"
      : "pro_weekly";
    const entRecord = {
      id: randomUUID(),
      user_code: user.code,
      product_id: productId,
      status: "active",
      provider: "admin",
      provider_ref: `admin-grant-${Date.now()}`,
      granted_at: now.toISOString(),
      expires_at: null,
      metadata: {
        source: "manual_admin_grant",
        days,
        reason: reason || "admin manual grant",
        grantedBy: "admin-ui",
        baseDate: baseDate.toISOString(),
        previousTier: user.tier,
        previousExpiresAt: user.tier_expires_at,
      },
    };
    const { error: entErr } = await supabaseAdmin
      .from("iap_entitlements")
      .insert(entRecord);
    if (entErr) return jsonError(400, `Insert entitlement failed: ${entErr.message}`);

    return Response.json({
      ok: true,
      user: {
        code: user.code,
        email: user.email,
        previousTier: user.tier,
        previousExpiresAt: user.tier_expires_at,
      },
      granted: {
        days,
        productId,
        baseDate: baseDate.toISOString(),
        expiresAt: expiresAt.toISOString(),
        reason: entRecord.metadata.reason,
      },
      entitlementId: entRecord.id,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
