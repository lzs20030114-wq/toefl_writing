"use client";

/**
 * Client-side helpers for tracking exam audio playback health.
 *
 * Events (unlock → play lifecycle):
 *   unlock_ok        — silent-WAV unlock succeeded inside the start gesture
 *   unlock_blocked   — even the in-gesture unlock was rejected
 *   play_blocked     — play() rejected with NotAllowedError mid-exam
 *   play_ok          — 'playing' fired (carries firstFrameMs = play()→playing)
 *   play_error       — media error (bad file / network / decode)
 *   stall_timeout    — watchdog gave up waiting for 'playing'
 *   tts_fallback     — clip failed and we rescued via Web Speech
 *   overlay_shown    — recovery overlay displayed to the user
 *   overlay_resume   — user tapped 继续考试 on the overlay
 *   interrupted      — playback cut by tab switch / phone call
 *
 * Fire-and-forget POST to /api/analytics/audio. Failures are silently
 * swallowed — tracking must never break the exam flow.
 */

const ENDPOINT = "/api/analytics/audio";

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

function isBrowser() {
  return typeof window !== "undefined" && typeof fetch !== "undefined";
}

/**
 * Fire an audio analytics event. Fire-and-forget; safe to ignore.
 *
 * @param {string} event   One of VALID_EVENTS
 * @param {object} [opts]
 * @param {string} [opts.section]        'listening' | 'speaking'
 * @param {string} [opts.taskType]       e.g. 'lcr' | 'la' | 'repeat' | 'interview'
 * @param {string} [opts.itemId]         question/item id
 * @param {string} [opts.audioPath]      the src being played
 * @param {string} [opts.errorName]      DOMException name (for errors)
 * @param {number} [opts.mediaErrorCode] HTMLMediaElement.error.code
 * @param {number} [opts.readyState]     element readyState at failure
 * @param {number} [opts.networkState]   element networkState at failure
 * @param {number} [opts.firstFrameMs]   play() → 'playing' latency (play_ok)
 * @param {string} [opts.reason]         blocked reason
 * @param {object} [opts.metadata]       small JSON-serializable extras
 */
export function trackAudioEvent(event, opts = {}) {
  if (!isBrowser()) return;
  if (!VALID_EVENTS.has(event)) return;
  try {
    const body = JSON.stringify({
      event,
      section: opts.section || null,
      taskType: opts.taskType || null,
      itemId: opts.itemId || null,
      audioPath: opts.audioPath || null,
      errorName: opts.errorName || null,
      mediaErrorCode: Number.isFinite(opts.mediaErrorCode) ? opts.mediaErrorCode : null,
      readyState: Number.isFinite(opts.readyState) ? opts.readyState : null,
      networkState: Number.isFinite(opts.networkState) ? opts.networkState : null,
      firstFrameMs: Number.isFinite(opts.firstFrameMs) ? Math.round(opts.firstFrameMs) : null,
      reason: opts.reason || null,
      metadata: opts.metadata && typeof opts.metadata === "object" ? opts.metadata : null,
    });
    // keepalive so the request survives an imminent navigation/unload.
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => { /* swallow */ });
  } catch {
    /* swallow */
  }
}
