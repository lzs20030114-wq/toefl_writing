-- Migration: atomic, server-authoritative daily-usage metering for /api/ai
-- Run this in the Supabase SQL editor BEFORE (or together with) deploying the
-- /api/ai server-side usage increment. It is idempotent — safe to re-run.
--
-- Background
-- ----------
-- The free/pro daily limit (the `daily_usage` table) used to be incremented
-- only CLIENT-SIDE, after a practice was saved. That let a scripted client call
-- /api/ai directly and simply never report usage, getting unlimited free AI
-- grading. /api/ai now increments this counter itself, atomically, via
-- increment_daily_usage(). The limit therefore now counts AI gradings (writing,
-- the 3 writing tasks of a standard mock, speaking-interview scoring) — local
-- auto-graded practice (reading/listening/build-sentence/adaptive mock) no
-- longer consumes a credit.
--
-- This migration:
--   1. ensures the table exists with an `updated_at` column,
--   2. guarantees the (user_code, date) PRIMARY KEY the atomic upsert needs
--      (de-duplicating any pre-existing rows so the constraint can be added),
--   3. installs the increment_daily_usage() RPC.

-- ── 1. Ensure the table + columns exist ─────────────────────────
CREATE TABLE IF NOT EXISTS daily_usage (
  user_code   TEXT    NOT NULL,
  date        DATE    NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The table predates this migration on existing deployments and may lack
-- updated_at; the RPC writes it, so make sure it's there.
ALTER TABLE daily_usage ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 2. Guarantee the (user_code, date) primary key ──────────────
-- The atomic upsert below needs a unique constraint on (user_code, date). The
-- old client-driven read-then-write path could race and create duplicate rows,
-- which would block adding the PK — so collapse duplicates first (summing
-- usage_count so no usage is lost), then add the key. Skipped entirely if a PK
-- already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'daily_usage'::regclass AND contype = 'p'
  ) THEN
    CREATE TEMP TABLE _daily_usage_dedup ON COMMIT DROP AS
      SELECT user_code,
             date,
             SUM(usage_count)::int AS usage_count,
             MAX(updated_at)       AS updated_at
      FROM daily_usage
      GROUP BY user_code, date;

    DELETE FROM daily_usage;

    INSERT INTO daily_usage (user_code, date, usage_count, updated_at)
      SELECT user_code, date, usage_count, updated_at FROM _daily_usage_dedup;

    ALTER TABLE daily_usage ADD PRIMARY KEY (user_code, date);
  END IF;
END$$;

-- ── 3. Atomic increment-with-cap RPC ────────────────────────────
-- Returns the post-increment usage_count, or -1 if the increment would exceed
-- the cap (in which case nothing is written). The date is passed in from the
-- caller (Node computes it as UTC `toISOString().split("T")[0]`) so the write
-- and the pre-flight read in /api/ai always agree on "today", independent of
-- the database server's timezone.
CREATE OR REPLACE FUNCTION increment_daily_usage(
  p_user_code TEXT,
  p_count     INTEGER,
  p_cap       INTEGER,
  p_date      DATE
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_after INTEGER;
BEGIN
  INSERT INTO daily_usage (user_code, date, usage_count, updated_at)
  VALUES (p_user_code, p_date, p_count, NOW())
  ON CONFLICT (user_code, date) DO UPDATE
    SET usage_count = daily_usage.usage_count + EXCLUDED.usage_count,
        updated_at  = NOW()
  RETURNING usage_count INTO v_after;

  IF v_after > p_cap THEN
    -- Roll back: a concurrent call pushed us over the cap.
    UPDATE daily_usage
    SET usage_count = usage_count - p_count,
        updated_at  = NOW()
    WHERE user_code = p_user_code AND date = p_date;
    RETURN -1;
  END IF;

  RETURN v_after;
END;
$$;
