import { bindReferral } from "../../../../lib/referral/service";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";

const limiter = createRateLimiter("referral-bind", { max: 10 });

function jsonError(status, error) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(request) {
  try {
    const ip = getIp(request);
    if (limiter.isLimited(ip)) {
      return jsonError(429, "Too many attempts. Please try again later.");
    }

    const body = await request.json().catch(() => ({}));
    const inviterCode = String(body?.inviterCode || "").trim().toUpperCase();
    const inviteeCode = String(body?.inviteeCode || "").trim().toUpperCase();
    const source = ["link", "manual"].includes(body?.source) ? body.source : "manual";

    if (inviterCode.length !== 6) return jsonError(400, "invalid inviter code");
    if (inviteeCode.length !== 6) return jsonError(400, "invalid invitee code");

    const result = await bindReferral({
      inviterCode,
      inviteeCode,
      inviteeIp: ip,
      source,
    });

    // Always 200 — UI handles soft failures (already_bound, cap_exceeded, etc.)
    return Response.json(result);
  } catch (e) {
    return jsonError(500, e?.message || "Unexpected server error");
  }
}
