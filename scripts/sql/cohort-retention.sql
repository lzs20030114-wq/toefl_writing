-- Cohort retention / stickiness / activation analytics.
--
-- Fills the gap the admin dashboard did NOT cover: signup-cohort retention
-- (did the people who joined on day X come back to practice?), DAU/MAU
-- stickiness, and activation (did a signup ever do a real practice).
--
-- All first-party data already lives in Postgres — no tracking SDK, no extra
-- service, nothing leaves Supabase. This is two read-only VIEWs over the
-- existing `users` and `sessions` tables, consumed by /api/admin/retention
-- exactly like referral_funnel_daily is consumed by the referral admin page.
--
-- Run ONCE in the Supabase SQL Editor. Re-running is safe (CREATE OR REPLACE).

-- ---------------------------------------------------------------------------
-- View 1: per signup-day cohort retention.
--
-- cohort_day  = users.created_at::date  (≈ first login = signup for real users)
-- activity    = sessions.date::date     (one sessions row = one real practice)
--
-- Metric semantics (BOUNDED / "returned-within-N-days", nests d1 ⊆ d7 ⊆ d30):
--   activated = signed-up users who did ANY practice on/after signup day
--   d1  = came BACK on the day after signup            (offset = 1)
--   d7  = came back at least once within the first week (offset 1..7)
--   d30 = came back at least once within 30 days        (offset 1..30)
-- "returned-within-N" is the most robust read at small/young-app scale, where
-- exact-anniversary (day == N) retention is almost always 0 from sparseness.
--
-- Pre-generated but never-activated access codes (status = 'pending') are
-- excluded so they don't inflate cohort denominators. Real users flip to
-- 'active' on first login; email users have NULL status (kept — NULL is
-- distinct from 'pending'). Day boundaries are UTC (timestamptz -> date).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cohort_retention_daily AS
WITH cohort AS (
  -- Pin the day bucket to UTC so it matches the endpoint's UTC `today`/age math
  -- regardless of the database session's TimeZone setting.
  SELECT users.code AS user_code, (users.created_at AT TIME ZONE 'UTC')::date AS cohort_day
  FROM users
  WHERE users.created_at IS NOT NULL
    AND users.status IS DISTINCT FROM 'pending'
),
act AS (
  SELECT DISTINCT sessions.user_code, (sessions.date AT TIME ZONE 'UTC')::date AS active_day
  FROM sessions
),
joined AS (
  SELECT
    c.cohort_day,
    c.user_code,
    (a.active_day - c.cohort_day) AS day_offset
  FROM cohort c
  LEFT JOIN act a ON a.user_code = c.user_code
)
SELECT
  cohort_day,
  COUNT(DISTINCT user_code)                                            AS cohort_size,
  COUNT(DISTINCT user_code) FILTER (WHERE day_offset >= 0)             AS activated,
  COUNT(DISTINCT user_code) FILTER (WHERE day_offset = 1)              AS d1,
  COUNT(DISTINCT user_code) FILTER (WHERE day_offset BETWEEN 1 AND 7)  AS d7,
  COUNT(DISTINCT user_code) FILTER (WHERE day_offset BETWEEN 1 AND 30) AS d30
FROM joined
GROUP BY cohort_day
ORDER BY cohort_day DESC;

-- ---------------------------------------------------------------------------
-- View 2: stickiness — distinct active users in trailing windows.
-- Single row. stickiness ratio = dau / mau is computed in the endpoint.
-- Activity = sessions (real practice), NOT users.last_login: persistent
-- localStorage login means returning users often never re-hit the auth
-- endpoint, so last_login under-counts engagement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW engagement_stickiness AS
SELECT
  COUNT(DISTINCT user_code) FILTER (WHERE date >= NOW() - INTERVAL '1 day')  AS dau,
  COUNT(DISTINCT user_code) FILTER (WHERE date >= NOW() - INTERVAL '7 days')  AS wau,
  COUNT(DISTINCT user_code) FILTER (WHERE date >= NOW() - INTERVAL '30 days') AS mau
FROM sessions;

-- Lock these views down to the service role only. They are admin-analytics
-- aggregates; a plain view bypasses the base tables' RLS, and Supabase's
-- default privileges would otherwise expose them to the public anon /
-- authenticated roles via PostgREST (GET /rest/v1/cohort_retention_daily).
-- The admin endpoint reads them with the service-role key, which is unaffected.
REVOKE ALL ON cohort_retention_daily FROM anon, authenticated;
REVOKE ALL ON engagement_stickiness   FROM anon, authenticated;

-- Refresh PostgREST's schema cache so supabaseAdmin.from('cohort_retention_daily')
-- and .from('engagement_stickiness') resolve immediately after this migration.
NOTIFY pgrst, 'reload schema';
