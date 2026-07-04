-- Widen user_question_banks.type CHECK to ALL 12 personal-bank types (one-time migration).
--
-- The table was created (scripts/sql/user-question-banks.sql) with an INLINE CHECK
-- constraint scoped to the MVP writing types ('discussion','email'). This migration
-- drops that constraint and re-adds it covering every subtype the personal bank will
-- ever store, so no further DB change is needed as later phases (reading/listening/
-- speaking/build) come online:
--   writing:   discussion, email, build
--   reading:   ctw, rdl, ap
--   listening: lcr, la, lc, lat
--   speaking:  repeat, interview
--
-- NOTE: 'type' is the STORED/picker key, NOT the extractor key (extractor uses
-- 'academic', stored as 'discussion' — mapped at the API boundary).
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute once (like the
-- retention-analytics migration, this project applies SQL migrations manually).
-- Idempotent: re-running is a no-op (drops the current CHECK by name if present,
-- then re-adds the widened one).

DO $$
DECLARE
  con_name text;
BEGIN
  -- Find the current CHECK constraint on user_question_banks.type by definition,
  -- since an inline CHECK gets an auto-generated name (typically
  -- user_question_banks_type_check, but we resolve it robustly).
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE t.relname = 'user_question_banks'
    AND n.nspname = 'public'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%type%'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_question_banks DROP CONSTRAINT %I', con_name);
  END IF;

  ALTER TABLE public.user_question_banks
    ADD CONSTRAINT user_question_banks_type_check
    CHECK (type IN (
      'discussion', 'email', 'build',
      'ctw', 'rdl', 'ap',
      'lcr', 'la', 'lc', 'lat',
      'repeat', 'interview'
    ));
END $$;
