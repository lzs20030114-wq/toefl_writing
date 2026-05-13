/**
 * POST /api/analytics/referral — event sink for the referral funnel.
 *
 * Fire-and-forget from the client. Returns 204 even on most failures —
 * tracking should never break user flow.
 */

import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";

const VALID_EVENTS = new Set([
  "link_visit",
  "modal_open",
  "bind_attempt",
  "bind_success",
  "bind_rejected",
  "first_practice",
  "grant_success",
  "share_link_copied",
  "share_text_copied",
]);

// Generous limit — the funnel can fire 5-7 events per signup.
const limiter = createRateLimiter("analytics-referral", { max: 60 });

function silent() {
  return new Response(null, { status: 204 });
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || null;
}

function safeString(value, max) {
  if (value == null) return null;
  return String(value).slice(0, max);
}

export async function POST(request) {
  try {
    if (limiter.isLimited(getIp(request))) return silent();
    if (!isSupabaseAdminConfigured) return silent();

    const body = await request.json().catch(() => ({}));
    const event = String(body?.event || "");
    if (!VALID_EVENTS.has(event)) return silent();

    const row = {
      event,
      inviter_code: normalizeCode(body?.inviterCode),
      invitee_code: normalizeCode(body?.inviteeCode),
      source: safeString(body?.source, 32),
      reason: safeString(body?.reason, 64),
      metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : null,
      ip: getIp(request),
      user_agent: safeString(request.headers.get("user-agent"), 500),
    };

    // Fire-and-forget — don't block the response
    supabaseAdmin
      .from("referral_events")
      .insert(row)
      .then(() => {})
      .catch(() => {});

    return silent();
  } catch {
    return silent();
  }
}
