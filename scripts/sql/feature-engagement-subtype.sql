-- Feature-engagement analytics — 小题型（subtype）下钻层。
--
-- feature-engagement.sql 按 sessions.type 整科聚合（造句/阅读/听力/…）。本文件在其
-- 之上加一层「小题型」维度，回答「阅读里 CTW/RDL/AP/模考 谁更吸引人」这类问题，
-- 供 /api/admin/retention 的「按小题型」粒度使用。
--
-- ⚠️ 归一副作用（这是修正，不是回归）：本文件用 CREATE OR REPLACE 给 feature_sessions
--    追加了 subtype 列，同时把遗留类型并入所属科目——
--      adaptive-reading  → reading
--      adaptive-listening → listening
--      speaking-exam     → speaking
--    这三类是旧版自适应/口语模考的历史记录；新代码早已改写 canonical type
--    （reading/listening/speaking + details.subtype='mock'，见 components/mockExam/
--    AdaptiveExamShell.js 与 SpeakingExamShell.js）。归一后这些历史记录会并入所属科目，
--    因此整科（feature_engagement_totals 等）的科目级数字会小幅变化——这是把散落在
--    遗留 type 里的记录归位，属修正而非退化。
--
-- Run ONCE in the Supabase SQL Editor，需在 feature-engagement.sql 之后。
-- 重跑安全（CREATE OR REPLACE）。依赖 feature-engagement.sql 建好的
-- session_item_count() 与 feature_sessions。
--
-- 若报 42P16（cannot change name of view column）：说明线上 feature_sessions 的列
-- 与仓库版本不一致（CREATE OR REPLACE 只允许在末尾追加列）。处理：先
--   DROP VIEW IF EXISTS feature_subtype_stickiness, feature_subtype_totals,
--     feature_weekly, feature_stickiness, feature_first_touch,
--     feature_engagement_totals, feature_sessions CASCADE;
-- 再依次重跑 feature-engagement.sql 与本文件。

-- ---------------------------------------------------------------------------
-- feature_sessions：保持原有 6 列（user_code, feature, active_day, date, items,
-- is_pro）名称/类型/顺序完全不变，仅在末尾追加第 7 列 subtype（Postgres 的
-- CREATE OR REPLACE VIEW 只允许追加列，不允许改动已有列）。
--   · feature：把遗留 type 归一到所属科目（见上方副作用说明）。
--   · subtype：遗留三类型 → 'mock'；否则取 details.subtype，无 subtype 的
--     bs/discussion/email/mock 及缺标旧数据回退为 type 本身。
--   · items：session_item_count() 仍传原始 s.type，折算口径与整科视图完全一致。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW feature_sessions AS
SELECT
  s.user_code,
  CASE s.type
    WHEN 'adaptive-reading'  THEN 'reading'
    WHEN 'adaptive-listening' THEN 'listening'
    WHEN 'speaking-exam'     THEN 'speaking'
    ELSE s.type
  END                                                           AS feature,
  (s.date AT TIME ZONE 'UTC')::date                             AS active_day,
  s.date,
  session_item_count(s.type, s.score, s.details)                AS items,
  (u.tier IN ('pro', 'legacy'))                                 AS is_pro,
  CASE
    WHEN s.type IN ('adaptive-reading', 'adaptive-listening', 'speaking-exam') THEN 'mock'
    ELSE COALESCE(NULLIF(s.details->>'subtype', ''), s.type)
  END                                                           AS subtype
FROM sessions s
JOIN users u ON u.code = s.user_code
WHERE u.status IS DISTINCT FROM 'pending';

-- ---------------------------------------------------------------------------
-- feature_subtype_totals：与 feature_engagement_totals 完全同构（同一批指标列），
-- 只是 GROUP BY feature, subtype，输出多一列 subtype。"哪个小题型最吸引人"。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW feature_subtype_totals AS
WITH per_user AS (
  SELECT feature, subtype, user_code, bool_or(is_pro) AS is_pro, COUNT(*) AS user_sessions
  FROM feature_sessions
  GROUP BY feature, subtype, user_code
)
SELECT
  t.feature,
  t.subtype,
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
    subtype,
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
  GROUP BY feature, subtype
) t
LEFT JOIN (
  SELECT
    feature,
    subtype,
    COUNT(*) FILTER (WHERE user_sessions >= 2)                    AS repeat_2plus,
    COUNT(*) FILTER (WHERE user_sessions >= 3)                    AS repeat_3plus,
    COUNT(*) FILTER (WHERE is_pro)                                AS users_pro,
    COUNT(*) FILTER (WHERE NOT is_pro)                            AS users_free,
    COUNT(*) FILTER (WHERE is_pro AND user_sessions >= 2)         AS repeat2_pro,
    COUNT(*) FILTER (WHERE NOT is_pro AND user_sessions >= 2)     AS repeat2_free
  FROM per_user
  GROUP BY feature, subtype
) r ON r.feature = t.feature AND r.subtype = t.subtype
ORDER BY t.users DESC;

-- ---------------------------------------------------------------------------
-- feature_subtype_stickiness：与 feature_stickiness 同构（mature_users /
-- returned_users，7 天成熟口径），GROUP BY feature, subtype。"用了同一小题型还回来"。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW feature_subtype_stickiness AS
WITH ux AS (
  SELECT
    user_code,
    feature,
    subtype,
    MIN(active_day)                     AS first_day,
    MAX(active_day) > MIN(active_day)   AS returned
  FROM feature_sessions
  GROUP BY user_code, feature, subtype
)
SELECT
  feature,
  subtype,
  COUNT(*) FILTER (WHERE first_day <= (NOW() AT TIME ZONE 'UTC')::date - 7)                  AS mature_users,
  COUNT(*) FILTER (WHERE first_day <= (NOW() AT TIME ZONE 'UTC')::date - 7 AND returned)     AS returned_users
FROM ux
GROUP BY feature, subtype;

-- Lock these down to the service role only (same as feature-engagement.sql). A
-- plain view bypasses base-table RLS; without this PostgREST would expose them
-- to the public anon / authenticated roles. The admin endpoint uses the
-- service-role key, which is unaffected.
REVOKE ALL ON feature_sessions             FROM anon, authenticated;
REVOKE ALL ON feature_subtype_totals       FROM anon, authenticated;
REVOKE ALL ON feature_subtype_stickiness   FROM anon, authenticated;

-- Refresh PostgREST's schema cache so supabaseAdmin.from('feature_subtype_*')
-- resolves immediately after this migration.
NOTIFY pgrst, 'reload schema';
