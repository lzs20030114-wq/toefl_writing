import { activateReferral } from "../../../../lib/referral/service";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";

const limiter = createRateLimiter("referral-activate", { max: 30 });

function jsonError(status, error) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) {
      return jsonError(429, "Too many attempts. Please try again later.");
    }

    const body = await request.json().catch(() => ({}));
    const inviteeCode = String(body?.inviteeCode || "").trim().toUpperCase();
    if (inviteeCode.length !== 6) return jsonError(400, "invalid invitee code");

    // Activation is idempotent and gated server-side by:
    //  - existing pending referral row
    //  - invitee has ≥1 saved session
    //  - inviter cap re-check
    const result = await activateReferral({ inviteeCode });
    return Response.json(result);
  } catch (e) {
    return jsonError(500, e?.message || "Unexpected server error");
  }
}
