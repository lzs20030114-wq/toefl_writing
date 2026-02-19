-- Login code management (private beta issuance)
-- Run in Supabase SQL Editor

-- Access code inventory managed by admin only.
CREATE TABLE IF NOT EXISTS access_codes (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'issued', 'revoked')),
  issued_to TEXT NULL,
  issued_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_codes_status ON access_codes(status);
CREATE INDEX IF NOT EXISTS idx_access_codes_created_at ON access_codes(created_at DESC);

-- Ensure users exists for session FK.
CREATE TABLE IF NOT EXISTS users (
  code TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ DEFAULT NOW()
);

-- Practice sessions tied to issued codes.
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_code TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
  type TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  score JSONB NOT NULL DEFAULT '{}',
  details JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_code ON sessions(user_code);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(user_code, date DESC);

-- RLS: block public direct access to access_codes.
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'access_codes' AND policyname = 'deny all access_codes'
  ) THEN
    CREATE POLICY "deny all access_codes" ON access_codes
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- Keep existing open policies for users/sessions if you still use anon frontend writes.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'Allow all operations on users'
  ) THEN
    CREATE POLICY "Allow all operations on users" ON users
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sessions' AND policyname = 'Allow all operations on sessions'
  ) THEN
    CREATE POLICY "Allow all operations on sessions" ON sessions
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

