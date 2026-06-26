-- User question banks — let users import their own questions into a PERSONAL bank.
-- (image/PDF → AI extract → preview → save). MVP types: discussion + email.
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS user_question_banks (
  id BIGSERIAL PRIMARY KEY,
  user_code TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
  -- Stored/picker type. NOT the extractor key: extractor uses 'academic', here we store 'discussion'.
  -- CHECK is MVP-scoped; widen when reading/listening/bs land.
  type TEXT NOT NULL CHECK (type IN ('discussion', 'email')),
  -- The question payload in the LIVE per-type shape the practice pages render:
  --   discussion: { id, course, professor:{name,text}, students:[{name,text}] }
  --   email:      { id, topic, scenario, direction, goals[], to, subject }
  data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'draft')),
  -- Free-form provenance, e.g. 'image' | 'paste' | 'pdf'.
  source TEXT NULL,
  -- Server-minted authoritative id (usr_{code}_{ts}_{i}). 'usr_' is a RESERVED prefix
  -- no global generator emits, so personal ids never collide with global ids in
  -- shared "done" Sets. Re-POST is idempotent via the UNIQUE below.
  item_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_code, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_question_banks_user_type
  ON user_question_banks(user_code, type);

CREATE INDEX IF NOT EXISTS idx_user_question_banks_user
  ON user_question_banks(user_code, created_at DESC);

ALTER TABLE user_question_banks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_question_banks'
      AND policyname = 'Allow all operations on user_question_banks'
  ) THEN
    CREATE POLICY "Allow all operations on user_question_banks" ON user_question_banks
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
