-- Referral program: invitee fills in inviter's code → inviter gets +3 days Pro
-- Run in Supabase SQL Editor
--
-- Reward model (single-sided):
--   • Invitee: keeps the existing auto 3-day Pro trial (pro_trial flag). No extra reward from referral.
--   • Inviter: gets +3 days Pro stacked on tier_expires_at, after invitee activates (≥1 practice).
--   • Cap: max 30 days inviter can earn via referrals (≈10 successful referrals).

-- ─────────────────────────────────────────────────────────
-- referrals: one row per invitee, tracks lifecycle:
--   pending   → just bound (signup), invitee hasn't practiced yet
--   activated → invitee completed ≥1 practice; inviter reward pending
--   granted   → inviter received +3 days Pro
--   rejected  → failed validation (self-ref, cap exceeded, ip flood)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  inviter_code TEXT NOT NULL,                         -- existing user's 6-char code
  invitee_code TEXT NOT NULL UNIQUE,                   -- new user (1 referral per invitee, ever)
  source TEXT NOT NULL DEFAULT 'manual',               -- 'link' (URL ?ref=) | 'manual' (typed in signup)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'activated', 'granted', 'rejected')),
  invitee_ip TEXT NULL,                                -- abuse signal (24h same-ip throttle)
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ NULL,
  rewards_granted_at TIMESTAMPTZ NULL,
  rejection_reason TEXT NULL                           -- 'self_ref' | 'ip_flood' | 'cap_exceeded' | etc.
);

CREATE INDEX IF NOT EXISTS idx_referrals_inviter        ON referrals(inviter_code);
CREATE INDEX IF NOT EXISTS idx_referrals_status         ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_invitee_ip     ON referrals(invitee_ip, bound_at);
CREATE INDEX IF NOT EXISTS idx_referrals_bound_at       ON referrals(bound_at DESC);

-- RLS: admin-only (service-role bypasses; deny anon/auth direct access).
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'referrals' AND policyname = 'deny all referrals'
  ) THEN
    CREATE POLICY "deny all referrals" ON referrals
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────
-- Helper view: per-inviter stats (used by /api/referral/stats)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW referral_stats AS
SELECT
  inviter_code,
  COUNT(*) FILTER (WHERE status IN ('pending', 'activated'))     AS pending_count,
  COUNT(*) FILTER (WHERE status = 'granted')                      AS granted_count,
  COUNT(*) FILTER (WHERE status = 'granted') * 3                  AS days_earned,
  MAX(rewards_granted_at)                                          AS last_reward_at
FROM referrals
GROUP BY inviter_code;
