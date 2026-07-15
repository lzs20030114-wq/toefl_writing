/**
 * POST /api/analytics/audio — event sink for exam audio playback health.
 *
 * Fire-and-forget from the client. Returns 204 even on most failures —
 * tracking should never break the exam flow. The audio_events table may not
 * exist yet (migration is applied separately); the insert failing is silently
 * ignored so this route is deployable ahead of the migration.
 */

import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createRateLimiter, getIp } from "../../../../lib/rateLimit";

const VALID_EVENTS = new Set([
  "unlock_ok",
  "unlock_blocked",
  "play_blocked",
  "play_ok",
  "play_error",
  "stall_timeout",
  "tts_fallback",
  "overlay_shown",
  "overlay_resume",
  "interrupted",
]);

// Generous limit — one listening exam fires ~20 play_ok events plus unlocks.
const limiter = createRateLimiter("analytics-audio", { max: 120 });

function silent() {
  return new Response(null, { status: 204 });
}

function safeString(value, max) {
  if (value == null) return null;
  return String(value).slice(0, max);
}

function safeInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
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
      section: safeString(body?.section, 32),
      task_type: safeString(body?.taskType, 32),
      item_id: safeString(body?.itemId, 128),
      audio_path: safeString(body?.audioPath, 500),
      error_name: safeString(body?.errorName, 64),
      media_error_code: safeInt(body?.mediaErrorCode),
      ready_state: safeInt(body?.readyState),
      network_state: safeInt(body?.networkState),
      first_frame_ms: safeInt(body?.firstFrameMs),
      reason: safeString(body?.reason, 64),
      user_agent: safeString(request.headers.get("user-agent"), 500),
      metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : null,
    };

    // MUST await: Vercel freezes the lambda the moment the response returns,
    // so a dangling insert promise only flushes when a later request thaws
    // the same instance — on this low-traffic route that means rows arrive
    // minutes late or never (verified in prod 2026-07-15). The client fires
    // keepalive and never waits, so the extra ~50ms here is invisible.
    // Failures still swallowed: the table may lag the migration.
    try {
      await supabaseAdmin.from("audio_events").insert(row);
    } catch { /* tracking must never break the exam flow */ }

    return silent();
  } catch {
    return silent();
  }
}
