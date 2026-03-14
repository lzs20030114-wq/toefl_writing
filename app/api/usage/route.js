import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabaseAdmin";

const FREE_DAILY_LIMIT = 3;

function jsonError(status, error) {
  return Response.json({ error }, { status });
}

function todayDate() {
  return new Date().toISOString().split("T")[0];
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

    // Check user tier
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("tier")
      .eq("code", code)
      .maybeSingle();

    if (!user) return jsonError(404, "User not found");

    if (user.tier === "pro" || user.tier === "legacy") {
      return Response.json({ remaining: -1, limit: -1 }); // -1 = unlimited
    }

    const today = todayDate();
    const { data: usage } = await supabaseAdmin
      .from("daily_usage")
      .select("usage_count")
      .eq("user_code", code)
      .eq("date", today)
      .maybeSingle();

    const used = usage?.usage_count || 0;
    return Response.json({
      remaining: Math.max(0, FREE_DAILY_LIMIT - used),
      limit: FREE_DAILY_LIMIT,
    });
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}

/**
 * POST /api/usage — consume one usage
 */
export async function POST(request) {
  try {
    if (!isSupabaseAdminConfigured) {
      return Response.json({ remaining: FREE_DAILY_LIMIT - 1 });
    }

    const body = await request.json();
    const code = String(body?.code || "").toUpperCase().trim();
    if (!code) return jsonError(400, "Code is required");

    // Check user tier
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("tier")
      .eq("code", code)
      .maybeSingle();

    if (!user) return jsonError(404, "User not found");

    if (user.tier === "pro" || user.tier === "legacy") {
      return Response.json({ remaining: -1 }); // unlimited
    }

    const today = todayDate();
    const { data: existing } = await supabaseAdmin
      .from("daily_usage")
      .select("usage_count")
      .eq("user_code", code)
      .eq("date", today)
      .maybeSingle();

    if (existing) {
      const newCount = existing.usage_count + 1;
      await supabaseAdmin
        .from("daily_usage")
        .update({ usage_count: newCount })
        .eq("user_code", code)
        .eq("date", today);
      return Response.json({ remaining: Math.max(0, FREE_DAILY_LIMIT - newCount) });
    } else {
      await supabaseAdmin
        .from("daily_usage")
        .insert({ user_code: code, date: today, usage_count: 1 });
      return Response.json({ remaining: FREE_DAILY_LIMIT - 1 });
    }
  } catch (e) {
    return jsonError(500, e.message || "Unexpected server error");
  }
}
