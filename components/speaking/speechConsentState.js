"use client";

/**
 * Local UI marker for "this device recorded a consent grant for the current
 * user code". Its ONLY job is to decide whether to surface the 「语音授权管理」
 * (revoke) entry on the Speaking page.
 *
 * The authoritative consent state lives server-side in the users table
 * (speech_consent_at / speech_consent_revoked_at / speech_consent_version) and
 * gates transcription inside /api/speech/transcribe. This flag is NEVER read to
 * permit an upload — it is a discoverability hint, nothing more. Revoking clears
 * it so the entry hides, and the server independently re-prompts for consent on
 * the next recording (evaluateSpeechEligibility → NEEDS_CONSENT).
 *
 * All access is wrapped in try/catch and guarded against SSR (no window), so it
 * is safe to import from client components and call from effects/handlers.
 */

const KEY = "toefl-speech-consent-code";

// Fired on the same tab whenever the marker changes, so a footer mounted in the
// same session reflects a grant/revoke without a reload (the native `storage`
// event only fires in OTHER tabs).
export const SPEECH_CONSENT_EVENT = "toefl-speech-consent-changed";

function normCode(code) {
  return String(code || "").toUpperCase().trim();
}

function emitChange() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(SPEECH_CONSENT_EVENT));
  } catch {
    /* no-op */
  }
}

/** Record that `code` granted speech consent on this device. */
export function markSpeechConsent(code) {
  const c = normCode(code);
  if (!c || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, c);
  } catch {
    /* localStorage unavailable (private mode / quota) — non-fatal */
  }
  emitChange();
}

/** Forget the local consent marker (called after a successful revoke). */
export function clearSpeechConsent() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
  emitChange();
}

/** True iff this device holds a consent marker for `code`. */
export function hasLocalSpeechConsent(code) {
  const c = normCode(code);
  if (!c || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === c;
  } catch {
    return false;
  }
}
