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

-- Shared source: real sessions joined to their item_count + the user's current
-- tier, with pre-generated never-activated codes excluded (mirrors
-- cohort-retention.sql). Everything below reads from this so the exclusion,
-- item_count and tier logic live in one place.
--
-- is_pro segments away the free-tier paywall confound: AI-scored features
-- (写作/模考/口语) hit /api/ai and are capped at 3/day for free users, while
-- 造句/阅读/听力 are locally graded and unlimited. Comparing raw 做题量 across
-- that boundary is apples-to-oranges, so the totals view splits every metric by
-- is_pro. CAVEAT: this is the user's CURRENT tier — historical / 3-day-trial
-- tier is not reconstructed, so early trial-era (uncapped) activity by a now-
-- lapsed user lands in the 免费 bucket. Directionally useful, not exact.
CREATE OR REPLACE VIEW feature_sessions AS
SELECT
  s.user_code,
  s.type                                                        AS feature,
  (s.date AT TIME ZONE 'UTC')::date                             AS active_day,
  s.date,
  session_item_count(s.type, s.score, s.details)                AS items,
  (u.tier IN ('pro', 'legacy'))                                 AS is_pro
FROM sessions s
JOIN users u ON u.code = s.user_code
WHERE u.status IS DISTINCT FROM 'pending';

-- ---------------------------------------------------------------------------
-- View 1: per-feature totals, split by is_pro — "哪个功能最吸引人".
-- 一功能一行。触达用户 / 复练率 才是可跨功能比的吸引力信号；题目数是功能内部
-- 的投入量（单位不可比），故默认按触达用户排序。人均/复练率/占比在端点里除。
-- 每个指标都拆 全部 / pro / free，去掉付费墙对做题量的污染。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW feature_engagement_totals AS
WITH per_user AS (
  SELECT feature, user_code, bool_or(is_pro) AS is_pro, COUNT(*) AS user_sessions
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
  t.sessions_pro,
  t.items_pro,
  t.sessions_free,
  t.items_free,
  COALESCE(r.repeat_2plus, 0)  AS repeat_2plus,
  COALESCE(r.repeat_3plus, 0)  AS repeat_3plus,
  COALESCE(r.users_pro, 0)     AS users_pro,
  COALESCE(r.users_free, 0)    AS users_free,
  COALESCE(r.repeat2_pro, 0)   AS repeat2_pro,
  COALESCE(r.repeat2_free, 0)  AS repeat2_free
FROM (
  SELECT
    feature,
    COUNT(*)                                                                    AS sessions,
    SUM(items)                                                                  AS items,
    COUNT(DISTINCT user_code)                                                   AS users,
    COUNT(DISTINCT user_code) FILTER (WHERE date >= NOW() - INTERVAL '7 days')  AS active_7d,
    COUNT(DISTINCT user_code) FILTER (WHERE date >= NOW() - INTERVAL '30 days') AS active_30d,
    COUNT(*)   FILTER (WHERE is_pro)            AS sessions_pro,
    SUM(items) FILTER (WHERE is_pro)            AS items_pro,
    COUNT(*)   FILTER (WHERE NOT is_pro)        AS sessions_free,
    SUM(items) FILTER (WHERE NOT is_pro)        AS items_free
  FROM feature_sessions
  GROUP BY feature
) t
LEFT JOIN (
  SELECT
    feature,
    COUNT(*) FILTER (WHERE user_sessions >= 2)                    AS repeat_2plus,
    COUNT(*) FILTER (WHERE user_sessions >= 3)                    AS repeat_3plus,
    COUNT(*) FILTER (WHERE is_pro)                                AS users_pro,
    COUNT(*) FILTER (WHERE NOT is_pro)                            AS users_free,
    COUNT(*) FILTER (WHERE is_pro AND user_sessions >= 2)         AS repeat2_pro,
    COUNT(*) FILTER (WHERE NOT is_pro AND user_sessions >= 2)     AS repeat2_free
  FROM per_user
  GROUP BY feature
) r ON r.feature = t.feature
ORDER BY t.users DESC;

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
