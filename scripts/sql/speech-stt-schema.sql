-- Migration: Speaking-task STT consent + daily usage quota
-- Run this in your Supabase SQL editor before deploying the server STT route.
--
-- Adds two pieces:
--   1. users.speech_consent_at / speech_consent_revoked_at — PIPL compliance
--      (audio is personal info; explicit user consent is required before we
--      can upload to OpenAI Whisper).
--   2. daily_speech_usage — cost protection. We charge per-second to OpenAI,
--      so a cap per user per day prevents Pro-trial abuse from running up a
--      bill.
--
-- Consent semantics:
--   - speech_consent_at = NULL                                → never granted
--   - speech_consent_at IS NOT NULL AND revoked IS NULL       → active
--   - speech_consent_at IS NOT NULL AND revoked > consent_at  → revoked
--   - re-granting after revoke: set speech_consent_at to NOW()
--     AND clear speech_consent_revoked_at to NULL
-- The route's helper considers consent active iff
--   (speech_consent_at IS NOT NULL) AND (revoked IS NULL OR revoked < consent_at)

-- ── 1. Consent timestamps on users ───────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS speech_consent_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS speech_consent_revoked_at TIMESTAMPTZ NULL;

-- ── 2. Daily usage tracker ──────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_speech_usage (
  user_code TEXT NOT NULL,
  date DATE NOT NULL,
  seconds_used INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_code, date)
);

-- Lookups are always by (user_code, date) which is the PK already covers, but
-- date-range cleanup queries benefit from a secondary index.
CREATE INDEX IF NOT EXISTS daily_speech_usage_date_idx ON daily_speech_usage (date);

-- ── 3. Helper RPC: atomic increment with cap check ──────────
-- Returns the post-increment value, or -1 if the increment would exceed the
-- cap (in which case nothing is written). Used by /api/speech/transcribe to
-- enforce per-user daily limits without a read-then-write race.
CREATE OR REPLACE FUNCTION increment_speech_usage(
  p_user_code TEXT,
  p_seconds INTEGER,
  p_cap INTEGER
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_after INTEGER;
BEGIN
  INSERT INTO daily_speech_usage (user_code, date, seconds_used, updated_at)
  VALUES (p_user_code, v_today, p_seconds, NOW())
  ON CONFLICT (user_code, date) DO UPDATE
    SET seconds_used = daily_speech_usage.seconds_used + EXCLUDED.seconds_used,
        updated_at = NOW()
  RETURNING seconds_used INTO v_after;

  IF v_after > p_cap THEN
    -- Roll back the increment
    UPDATE daily_speech_usage
    SET seconds_used = seconds_used - p_seconds,
        updated_at = NOW()
    WHERE user_code = p_user_code AND date = v_today;
    RETURN -1;
  END IF;

  RETURN v_after;
END;
$$;
