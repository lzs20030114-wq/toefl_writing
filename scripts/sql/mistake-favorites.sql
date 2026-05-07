-- Mistake favorites — let users star individual wrong answers from /mistake-notebook
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS mistake_favorites (
  id BIGSERIAL PRIMARY KEY,
  user_code TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
  -- Reserved for future expansion to reading/listening MCQ wrong answers.
  subject TEXT NOT NULL DEFAULT 'bs',
  -- Soft-link to sessions(id). NOT a foreign key on purpose: deleting a session
  -- should NOT delete the favorite — the snapshot below survives independently.
  session_id BIGINT NULL,
  -- Position inside session.details[] at the time of starring.
  detail_index INT NULL,
  -- Self-contained snapshot so the card still renders if the source session is deleted.
  -- Shape (BS): { prompt, userAnswer, correctAnswer, grammar_points, sessionDate }
  snapshot JSONB NOT NULL,
  -- Reserved for v2 user notes.
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Same mistake instance can only be starred once per user (idempotent POST).
  UNIQUE (user_code, session_id, detail_index)
);

CREATE INDEX IF NOT EXISTS idx_mistake_favorites_user
  ON mistake_favorites(user_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mistake_favorites_session
  ON mistake_favorites(session_id);

ALTER TABLE mistake_favorites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mistake_favorites'
      AND policyname = 'Allow all operations on mistake_favorites'
  ) THEN
    CREATE POLICY "Allow all operations on mistake_favorites" ON mistake_favorites
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
