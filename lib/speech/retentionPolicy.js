/**
 * Pure decision logic for the Speaking recording-retention + open-beta features.
 *
 * Kept side-effect-free (no DB, no env reads) so both /api/speech/transcribe and
 * the jest suite can exercise the exact same rules. All I/O (Supabase reads,
 * storage upload) lives in the route; this module only decides.
 *
 * NOTE: intentionally NOT under lib/speakingEval/ — that tree holds the in-flight
 * scoring logic and is off-limits for this change. This is transport/compliance
 * policy, not scoring.
 */

// Consent version that unlocks retention. v1 (legacy, version null/1) consent
// still permits transcription/scoring but NOT retention — see route.
const SPEECH_CONSENT_VERSION = 2;

// Retention sampling caps.
const RETENTION_MAX_BYTES = 2 * 1024 * 1024; // skip anything ≥ 2 MB
const RETENTION_MAX_PER_DAY = 2;             // keep at most 2 clips/user/day

// Per-tier daily STT budget (seconds). Free is only reachable when the open-beta
// flag is on; without the flag free users are rejected upstream (NOT_PRO), so the
// pro cap stays the effective default and behavior is unchanged.
const PRO_DAILY_CAP_SECONDS = 60 * 60;  // 60 min — Pro/legacy (unchanged)
const FREE_DAILY_CAP_SECONDS = 15 * 60; // 15 min — free, open-beta only

// Private storage bucket for retained recordings (see speech-recording-retention.sql).
const SPEECH_BUCKET = "speech_recordings";

/**
 * Should this recording be retained?
 * ALL must hold: v2 consent, under the daily keep-count, under the size cap.
 * @param {{ consentVersion:number|null, todayCount:number, blobBytes:number }} p
 * @returns {boolean}
 */
function shouldRetainRecording({ consentVersion, todayCount, blobBytes }) {
  if (Number(consentVersion) !== SPEECH_CONSENT_VERSION) return false;
  if (!(Number(blobBytes) > 0) || Number(blobBytes) >= RETENTION_MAX_BYTES) return false;
  if (Number(todayCount) >= RETENTION_MAX_PER_DAY) return false;
  return true;
}

/** Pro/legacy (and dev "unknown") get the full budget; everyone else the free budget. */
function isProTier(tier) {
  return tier === "pro" || tier === "legacy" || tier === "unknown";
}

/** Daily STT second-budget for a tier. */
function dailyCapSecondsForTier(tier) {
  return isProTier(tier) ? PRO_DAILY_CAP_SECONDS : FREE_DAILY_CAP_SECONDS;
}

/**
 * Decide STT eligibility from an already-fetched users row (no I/O here).
 *
 * @param {object|null} user   users row: { tier, tier_expires_at, speech_consent_at,
 *                              speech_consent_revoked_at, speech_consent_version? }
 * @param {boolean} openBeta   whether Speaking open-beta flag is on
 * @returns {{ ok:true, tier:string, consentVersion:number|null }
 *          | { ok:false, code:string, message:string }}
 */
function evaluateSpeechEligibility(user, openBeta) {
  if (!user) return { ok: false, code: "INVALID_USER", message: "无效的用户码" };

  const expired = user.tier_expires_at && new Date(user.tier_expires_at).getTime() <= Date.now();
  const isPro = user.tier === "legacy" || (user.tier === "pro" && !expired);

  // Pro gate — bypassed only while the open-beta flag opens Speaking to free users.
  if (!isPro && !openBeta) {
    return { ok: false, code: "NOT_PRO", message: "语音识别为 Pro 专属功能" };
  }

  // Consent (PIPL) applies to every tier. Active iff granted and not since revoked.
  const grantedAt = user.speech_consent_at ? new Date(user.speech_consent_at).getTime() : 0;
  const revokedAt = user.speech_consent_revoked_at ? new Date(user.speech_consent_revoked_at).getTime() : 0;
  const consented = grantedAt > 0 && grantedAt > revokedAt;
  if (!consented) {
    return { ok: false, code: "NEEDS_CONSENT", message: "请先同意语音上传服务条款。" };
  }

  const consentVersion = user.speech_consent_version != null ? Number(user.speech_consent_version) : null;
  return { ok: true, tier: user.tier || "free", consentVersion };
}

module.exports = {
  SPEECH_CONSENT_VERSION,
  RETENTION_MAX_BYTES,
  RETENTION_MAX_PER_DAY,
  PRO_DAILY_CAP_SECONDS,
  FREE_DAILY_CAP_SECONDS,
  SPEECH_BUCKET,
  shouldRetainRecording,
  isProTier,
  dailyCapSecondsForTier,
  evaluateSpeechEligibility,
};
