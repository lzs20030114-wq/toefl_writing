import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";

const limiter = createRateLimiter("analytics-track", { max: 60 });

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) return new Response(null, { status: 204 });
    if (!isSupabaseAdminConfigured) return new Response(null, { status: 204 });

    const body = await request.json().catch(() => ({}));
    const path = String(body?.path || "").slice(0, 500);
    if (!path) return new Response(null, { status: 204 });

    const referrer = body?.referrer ? String(body.referrer).slice(0, 1000) : null;
    const userCode = body?.userCode ? String(body.userCode).slice(0, 10) : null;

    // Fire-and-forget insert — don't block the response
    supabaseAdmin
      .from("page_views")
      .insert({ path, referrer, user_code: userCode })
      .then(() => {})
      .catch(() => {});

    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
}
