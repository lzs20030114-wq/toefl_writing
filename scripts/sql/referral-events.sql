-- Referral funnel analytics — captures every meaningful step in the
-- invite-a-friend flow so we can compute conversion rates and spot
-- abuse / friction in the admin dashboard.
--
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS referral_events (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL CHECK (event IN (
    'link_visit',          -- ?ref= URL hit
    'modal_open',          -- login/signup modal opened with a captured ref
    'bind_attempt',        -- /api/referral/bind fired
    'bind_success',        -- bind returned status=pending
    'bind_rejected',       -- bind returned ok=false or non-pending status
    'first_practice',      -- invitee completed first practice → activate fired
    'grant_success',       -- inviter received +3 days
    'share_link_copied',   -- inviter copied their referral link
    'share_text_copied'    -- inviter copied the share text
  )),
  inviter_code TEXT NULL,
  invitee_code TEXT NULL,
  source TEXT NULL,                -- 'link' | 'manual'
  reason TEXT NULL,                -- rejection reason if applicable
  metadata JSONB NULL,
  ip TEXT NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_events_event      ON referral_events(event);
CREATE INDEX IF NOT EXISTS idx_referral_events_inviter    ON referral_events(inviter_code) WHERE inviter_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referral_events_invitee    ON referral_events(invitee_code) WHERE invitee_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referral_events_created_at ON referral_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_events_ip_time    ON referral_events(ip, created_at) WHERE ip IS NOT NULL;

-- RLS: admin-only (service-role bypasses; deny anon/auth direct access)
ALTER TABLE referral_events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'referral_events' AND policyname = 'deny all referral_events'
  ) THEN
    CREATE POLICY "deny all referral_events" ON referral_events
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

-- Convenience view: daily funnel stats per day for the last 30 days
CREATE OR REPLACE VIEW referral_funnel_daily AS
SELECT
  DATE(created_at) AS day,
  COUNT(*) FILTER (WHERE event = 'link_visit')        AS link_visits,
  COUNT(*) FILTER (WHERE event = 'bind_attempt')      AS bind_attempts,
  COUNT(*) FILTER (WHERE event = 'bind_success')      AS bind_successes,
  COUNT(*) FILTER (WHERE event = 'bind_rejected')     AS bind_rejections,
  COUNT(*) FILTER (WHERE event = 'first_practice')    AS first_practices,
  COUNT(*) FILTER (WHERE event = 'grant_success')     AS grants,
  COUNT(*) FILTER (WHERE event = 'share_link_copied') AS link_copies,
  COUNT(*) FILTER (WHERE event = 'share_text_copied') AS text_copies
FROM referral_events
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY day DESC;

-- Force PostgREST to refresh its schema cache so /api/analytics/referral
-- can write to the new table immediately after migration.
NOTIFY pgrst, 'reload schema';
