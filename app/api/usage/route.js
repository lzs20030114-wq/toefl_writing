import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../lib/rateLimit";
import { jsonError } from "../../../lib/apiResponse";

const FREE_DAILY_LIMIT = 3;
const PRO_DAILY_LIMIT = 100; // hidden abuse cap for pro/legacy

const limiter = createRateLimiter("usage", { max: 10 });

function todayDate() {
  return new Date().toISOString().split("T")[0];
}

function isProTier(user) {
  if (user.tier !== "pro" && user.tier !== "legacy") return false;
  if (user.tier === "legacy") return true;
  // Check expiration for pro
  if (user.tier_expires_at) {
    const t = new Date(user.tier_expires_at).getTime();
    if (Number.isFinite(t) && t <= Date.now()) return false;
  }
  return true;
}

/**
 * GET /api/usage?code=XXXXXX — check remaining daily usage
 */
export async function GET(request) {
  try {
    if (!isSupabaseAdminConfigured) {
      return Response.json({ remaining: FREE_DAILY_LIMIT, limit: FREE_DAILY_LIMIT });
    }

    const { searchParams } = new URL(request.url);
    const code = String(searchParams.get("code") || "").toUpperCase().trim();
    if (!code) return jsonError(400, "Code is required");

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("tier, tier_expires_at")
      .eq("code", code)
      .maybeSingle();

    if (!user) return jsonError(404, "User not found");

    const isPro = isProTier(user);

    // Auto-downgrade expired pro in DB
    if (!isPro && user.tier === "pro") {
      await supabaseAdmin.from("users").update({ tier: "free", tier_expires_at: null }).eq("code", code);
    }

    const today = todayDate();
    const { data: usage } = await supabaseAdmin
      .from("daily_usage")
      .select("usage_count")
      .eq("user_code", code)
      .eq("date", today)
      .maybeSingle();

    const used = usage?.usage_count || 0;

    if (isPro) {
      return Response.json({ remaining: -1, limit: -1 });
    }

    return Response.json({
      remaining: Math.max(0, FREE_DAILY_LIMIT - used),
      limit: FREE_DAILY_LIMIT,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

/**
 * POST /api/usage — consume usage (supports count parameter for bulk consumption)
 */
export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) {
      return jsonError(429, "Too many requests");
    }
    if (!isSupabaseAdminConfigured) {
      return Response.json({ remaining: FREE_DAILY_LIMIT - 1 });
    }

    const body = await request.json();
    const code = String(body?.code || "").toUpperCase().trim();
    if (!code) return jsonError(400, "Code is required");
    const count = Math.max(1, Math.min(10, Number(body?.count) || 1));

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("tier, tier_expires_at")
      .eq("code", code)
      .maybeSingle();

    if (!user) return jsonError(404, "User not found");

    const isPro = isProTier(user);

    // Auto-downgrade expired pro in DB
    if (!isPro && user.tier === "pro") {
      await supabaseAdmin.from("users").update({ tier: "free", tier_expires_at: null }).eq("code", code);
    }

    const limit = isPro ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;

    const today = todayDate();
    const { data: existing } = await supabaseAdmin
      .from("daily_usage")
      .select("usage_count")
      .eq("user_code", code)
      .eq("date", today)
      .maybeSingle();

    const used = existing?.usage_count || 0;

    // Silently block if over limit (pro users get a generic error, free users see normal limit)
    if (used >= limit) {
      if (isPro) {
        return Response.json({ error: "服务繁忙，请稍后再试" }, { status: 429 });
      }
      return Response.json({ remaining: 0 });
    }

    const newUsed = Math.min(used + count, limit);
    if (existing) {
      await supabaseAdmin
        .from("daily_usage")
        .update({ usage_count: newUsed })
        .eq("user_code", code)
        .eq("date", today);
      return Response.json({ remaining: isPro ? -1 : Math.max(0, limit - newUsed) });
    } else {
      await supabaseAdmin
        .from("daily_usage")
        .insert({ user_code: code, date: today, usage_count: count });
      return Response.json({ remaining: isPro ? -1 : Math.max(0, limit - count) });
    }
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
