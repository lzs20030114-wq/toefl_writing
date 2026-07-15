/**
 * Pure-logic tests for the Speaking retention + open-beta policy
 * (lib/speech/retentionPolicy.js). No DB, no env — just the decision rules that
 * /api/speech/transcribe delegates to.
 */

import {
  SPEECH_CONSENT_VERSION,
  RETENTION_MAX_BYTES,
  RETENTION_MAX_PER_DAY,
  PRO_DAILY_CAP_SECONDS,
  FREE_DAILY_CAP_SECONDS,
  shouldRetainRecording,
  isProTier,
  dailyCapSecondsForTier,
  evaluateSpeechEligibility,
} from "../lib/speech/retentionPolicy";

describe("shouldRetainRecording — retention sampling", () => {
  const base = { consentVersion: SPEECH_CONSENT_VERSION, todayCount: 0, blobBytes: 400 * 1024 };

  test("keeps a valid v2 recording under both caps", () => {
    expect(shouldRetainRecording(base)).toBe(true);
  });

  test("rejects when consent is not v2 (null / v1)", () => {
    expect(shouldRetainRecording({ ...base, consentVersion: null })).toBe(false);
    expect(shouldRetainRecording({ ...base, consentVersion: 1 })).toBe(false);
  });

  test("rejects once the daily keep-count is reached", () => {
    expect(shouldRetainRecording({ ...base, todayCount: RETENTION_MAX_PER_DAY - 1 })).toBe(true);
    expect(shouldRetainRecording({ ...base, todayCount: RETENTION_MAX_PER_DAY })).toBe(false);
    expect(shouldRetainRecording({ ...base, todayCount: RETENTION_MAX_PER_DAY + 5 })).toBe(false);
  });

  test("rejects blobs at/over the size cap and empty blobs", () => {
    expect(shouldRetainRecording({ ...base, blobBytes: RETENTION_MAX_BYTES })).toBe(false);
    expect(shouldRetainRecording({ ...base, blobBytes: RETENTION_MAX_BYTES + 1 })).toBe(false);
    expect(shouldRetainRecording({ ...base, blobBytes: 0 })).toBe(false);
    expect(shouldRetainRecording({ ...base, blobBytes: RETENTION_MAX_BYTES - 1 })).toBe(true);
  });
});

describe("dailyCapSecondsForTier — quota layering", () => {
  test("pro / legacy / dev-unknown get the full budget", () => {
    expect(dailyCapSecondsForTier("pro")).toBe(PRO_DAILY_CAP_SECONDS);
    expect(dailyCapSecondsForTier("legacy")).toBe(PRO_DAILY_CAP_SECONDS);
    expect(dailyCapSecondsForTier("unknown")).toBe(PRO_DAILY_CAP_SECONDS);
  });

  test("free / anything else gets the reduced free budget", () => {
    expect(dailyCapSecondsForTier("free")).toBe(FREE_DAILY_CAP_SECONDS);
    expect(dailyCapSecondsForTier(undefined)).toBe(FREE_DAILY_CAP_SECONDS);
  });

  test("caps are the documented 60 / 15 minutes", () => {
    expect(PRO_DAILY_CAP_SECONDS).toBe(60 * 60);
    expect(FREE_DAILY_CAP_SECONDS).toBe(15 * 60);
    expect(isProTier("pro")).toBe(true);
    expect(isProTier("free")).toBe(false);
  });
});

describe("evaluateSpeechEligibility — flag two-state + consent versioning", () => {
  const consented = {
    tier: "free",
    speech_consent_at: "2026-07-01T00:00:00Z",
    speech_consent_revoked_at: null,
  };

  test("unknown account → INVALID_USER", () => {
    expect(evaluateSpeechEligibility(null, true).code).toBe("INVALID_USER");
  });

  test("free user is gated (NOT_PRO) when open-beta is OFF", () => {
    const r = evaluateSpeechEligibility({ ...consented }, false);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NOT_PRO");
  });

  test("free user passes the Pro gate when open-beta is ON (still needs consent)", () => {
    // No consent yet → falls through to NEEDS_CONSENT, proving the Pro gate was bypassed.
    const noConsent = { tier: "free", speech_consent_at: null, speech_consent_revoked_at: null };
    expect(evaluateSpeechEligibility(noConsent, true).code).toBe("NEEDS_CONSENT");
    // With consent → ok.
    const r = evaluateSpeechEligibility({ ...consented }, true);
    expect(r.ok).toBe(true);
    expect(r.tier).toBe("free");
  });

  test("pro user is eligible regardless of the flag", () => {
    const pro = { ...consented, tier: "pro", tier_expires_at: "2099-01-01T00:00:00Z" };
    expect(evaluateSpeechEligibility(pro, false).ok).toBe(true);
    expect(evaluateSpeechEligibility(pro, true).ok).toBe(true);
  });

  test("expired pro is treated as free (gated when flag off)", () => {
    const expired = { ...consented, tier: "pro", tier_expires_at: "2000-01-01T00:00:00Z" };
    expect(evaluateSpeechEligibility(expired, false).code).toBe("NOT_PRO");
  });

  test("revoked consent → NEEDS_CONSENT", () => {
    const revoked = {
      tier: "legacy",
      speech_consent_at: "2026-07-01T00:00:00Z",
      speech_consent_revoked_at: "2026-07-02T00:00:00Z",
    };
    expect(evaluateSpeechEligibility(revoked, false).code).toBe("NEEDS_CONSENT");
  });

  test("consentVersion: null when the column is absent (pre-migration), numeric when present", () => {
    // Column absent → undefined on the row → null out.
    const v1 = evaluateSpeechEligibility({ ...consented, tier: "legacy" }, false);
    expect(v1.ok).toBe(true);
    expect(v1.consentVersion).toBeNull();
    // Column present with v2.
    const v2 = evaluateSpeechEligibility(
      { ...consented, tier: "legacy", speech_consent_version: SPEECH_CONSENT_VERSION },
      false,
    );
    expect(v2.consentVersion).toBe(SPEECH_CONSENT_VERSION);
  });
});
