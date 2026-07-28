-- 备考计划落库:把 examDate/目标分/当前分从 localStorage 同步到 users 表。
--
-- 背景:lib/studyPlan.js 目前只把备考计划存在浏览器 localStorage("先不落库"),
-- 云端没有考试日期,导致无法做「基于考试日期的留存/流失 cohort 分析」(报告 #3)。
-- 本迁移在 users 上加四个 nullable 字段,前端保存计划时顺带 upsert;历史用户的
-- 计划补不回来,但从落库起新数据即可支撑考前/考后流失分析。
--
-- 全部 nullable + IF NOT EXISTS,重复执行安全,不影响现有行。
-- 在 Supabase 控制台 SQL Editor 执行一次即可。

ALTER TABLE users ADD COLUMN IF NOT EXISTS exam_date DATE NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_score NUMERIC(3,1) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_score NUMERIC(3,1) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS study_plan_updated_at TIMESTAMPTZ NULL;

-- 便于按考试日期做分组分析(cohort/流失时点),给非空考试日期建部分索引。
CREATE INDEX IF NOT EXISTS idx_users_exam_date ON users (exam_date) WHERE exam_date IS NOT NULL;

-- 刷新 PostgREST schema 缓存,使 supabaseAdmin 立即能读写新列。
NOTIFY pgrst, 'reload schema';
