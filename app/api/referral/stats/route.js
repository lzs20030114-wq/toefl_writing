import { getReferralStats } from "../../../../lib/referral/service";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";

const limiter = createRateLimiter("referral-stats", { max: 30 });

function jsonError(status, error) {
  return Response.json({ ok: false, error }, { status });
}

export async function GET(request) {
  try {
    if (limiter.isLimited(getIp(request))) {
      return jsonError(429, "Too many attempts. Please try again later.");
    }

    const { searchParams } = new URL(request.url);
    const code = String(searchParams.get("code") || "").trim().toUpperCase();
    if (code.length !== 6) return jsonError(400, "invalid code");

    const stats = await getReferralStats(code);
    if (!stats) return Response.json({ ok: false, error: "unavailable" });

    return Response.json({ ok: true, ...stats });
  } catch (e) {
    return jsonError(500, e?.message || "Unexpected server error");
  }
}
