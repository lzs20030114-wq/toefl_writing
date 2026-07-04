-- Feature-engagement analytics — "做题量 / 功能吸引力".
--
-- Answers the questions the day-by-day cohort retention view does NOT:
--   · 哪个功能做题量最大 / 最黏（题目数、场次、人均、复练率）
--   · 什么功能把新用户拉进门（首触功能分布）
--   · 用了还回来的功能级留存（替代"注册后第N天有没有登录"的按天激活）
--   · 各功能每周做题量趋势
--
-- All first-party data already lives in `sessions` — no tracking SDK, nothing
-- leaves Supabase. These are read-only VIEWs + one IMMUTABLE helper function,
-- consumed by /api/admin/retention exactly like cohort_retention_daily is.
--
-- Run ONCE in the Supabase SQL Editor. Re-running is safe (CREATE OR REPLACE).
-- Depends on the same `sessions` / `users` tables as cohort-retention.sql.

-- ---------------------------------------------------------------------------
-- Helper: 一条 session 折算成"题目数"。
--
-- 口径优先取 score（写入时已算好），拿不到再用 details 数组长度兜底，最后回退 1：
--   bs         → score.total（造句题数）           ; fallback details[] 长度
--   reading    → score.total（选择题数）           ; fallback details.results[]
--   listening  → score.total                       ; fallback details.results[]
--   mock       → score.tasks[] 长度（3 个 task）    ; fallback 3
--   discussion → 1 篇
--   email      → 1 篇
--   speaking   → 1
-- mock 按"方案 A"作为独立功能"写作模考"，不拆进 造句/邮件/讨论。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION session_item_count(p_type text, p_score jsonb, p_details jsonb)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'bs' THEN COALESCE(
      NULLIF(p_score->>'total', '')::int,
      CASE WHEN jsonb_typeof(p_details) = 'array' THEN jsonb_array_length(p_details) END,
      1)
    WHEN 'reading' THEN COALESCE(
      NULLIF(p_score->>'total', '')::int,
      CASE WHEN jsonb_typeof(p_details->'results') = 'array' THEN jsonb_array_length(p_details->'results') END,
      1)
    WHEN 'listening' THEN COALESCE(
      NULLIF(p_score->>'total', '')::int,
      CASE WHEN jsonb_typeof(p_details->'results') = 'array' THEN jsonb_array_length(p_details->'results') END,
      1)
    WHEN 'mock' THEN COALESCE(
      CASE WHEN jsonb_typeof(p_score->'tasks') = 'array' THEN jsonb_array_length(p_score->'tasks') END,
      3)
    ELSE 1
  END;
$$;

-- Shared source: real sessions joined to their item_count, with pre-generated
-- never-activated codes excluded (mirrors cohort-retention.sql). Everything
-- below reads from this so the exclusion + item_count logic lives in one place.
CREATE OR REPLACE VIEW feature_sessions AS
SELECT
  s.user_code,
  s.type                                                        AS feature,
  (s.date AT TIME ZONE 'UTC')::date                             AS active_day,
  s.date,
  session_item_count(s.type, s.score, s.details)                AS items
FROM sessions s
WHERE s.user_code IN (
  SELECT code FROM users WHERE status IS DISTINCT FROM 'pending'
);

-- ---------------------------------------------------------------------------
-- View 1: per-feature totals — "哪个功能量最大 / 最黏".
-- 一功能一行。人均/复练率/占比在端点里除，和 retention 端点算百分比同款。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW feature_engagement_totals AS
WITH per_user AS (
  SELECT feature, user_code, COUNT(*) AS user_sessions
  FROM feature_sessions
  GROUP BY feature, user_code
)
SELECT
  t.feature,
  t.sessions,
  t.items,
  t.users,
  t.active_7d,
  t.active_30d,
  COALESCE(r.repeat_2plus, 0) AS repeat_2plus,
  COALESCE(r.repeat_3plus, 0) AS repeat_3plus
FROM (
  SELECT
    feature,
    COUNT(*)                                                              AS sessions,
    SUM(items)                                                            AS items,
    COUNT(DISTINCT user_code)                                             AS users,
    COUNT(DISTINCT user_code) FILTER (WHERE date >= NOW() - INTERVAL '7 days')  AS active_7d,
    COUNT(DISTINCT user_code) FILTER (WHERE date >= NOW() - INTERVAL '30 days') AS active_30d
  FROM feature_sessions
  GROUP BY feature
) t
LEFT JOIN (
  SELECT
    feature,
    COUNT(*) FILTER (WHERE user_sessions >= 2) AS repeat_2plus,
    COUNT(*) FILTER (WHERE user_sessions >= 3) AS repeat_3plus
  FROM per_user
  GROUP BY feature
) r ON r.feature = t.feature
ORDER BY t.items DESC;

-- ---------------------------------------------------------------------------
-- View 2: first-touch — 每个用户"人生第一场"落在哪个功能（什么把人拉进门）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW feature_first_touch AS
WITH firsts AS (
  SELECT DISTINCT ON (user_code) user_code, feature AS first_feature
  FROM feature_sessions
  ORDER BY user_code, date ASC
)
SELECT first_feature AS feature, COUNT(*) AS users
FROM firsts
GROUP BY first_feature
ORDER BY users DESC;

-- ---------------------------------------------------------------------------
-- View 3: feature-level stickiness — "用了还回来"的功能级留存。
-- 替代按天激活：首次用 X 在 ≥7 天前的成熟用户里，之后又在更晚一天再用 X 的比例。
-- 用"是否有更晚一天复用"的宽松定义（同 cohort 视图 returned-within 思路，小样本更稳）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW feature_stickiness AS
WITH ux AS (
  SELECT
    user_code,
    feature,
    MIN(active_day)                     AS first_day,
    MAX(active_day) > MIN(active_day)   AS returned
  FROM feature_sessions
  GROUP BY user_code, feature
)
SELECT
  feature,
  COUNT(*) FILTER (WHERE first_day <= (NOW() AT TIME ZONE 'UTC')::date - 7)                  AS mature_users,
  COUNT(*) FILTER (WHERE first_day <= (NOW() AT TIME ZONE 'UTC')::date - 7 AND returned)     AS returned_users
FROM ux
GROUP BY feature;

-- ---------------------------------------------------------------------------
-- View 4: weekly trend — 各功能每周题目数/场次（谁在涨谁在衰）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW feature_weekly AS
SELECT
  date_trunc('week', active_day)::date AS week,
  feature,
  COUNT(*)   AS sessions,
  SUM(items) AS items
FROM feature_sessions
GROUP BY 1, 2
ORDER BY 1 ASC, 2 ASC;

-- Lock these down to the service role only (same as cohort-retention.sql). A
-- plain view bypasses base-table RLS; without this PostgREST would expose them
-- to the public anon / authenticated roles. The admin endpoint uses the
-- service-role key, which is unaffected.
REVOKE ALL ON feature_sessions           FROM anon, authenticated;
REVOKE ALL ON feature_engagement_totals  FROM anon, authenticated;
REVOKE ALL ON feature_first_touch        FROM anon, authenticated;
REVOKE ALL ON feature_stickiness         FROM anon, authenticated;
REVOKE ALL ON feature_weekly             FROM anon, authenticated;

-- Refresh PostgREST's schema cache so supabaseAdmin.from('feature_*') resolves
-- immediately after this migration.
NOTIFY pgrst, 'reload schema';
