-- Migration: Speaking-task recording retention (compliance-gated, test-window only)
--
-- 用途:
--   给「口语录音留存基建（合规版）」提供落库能力。经用户 v2 同意后,按采样策略
--   把部分口语录音留存至私有桶,供 Azure 发音评测实验与评分校准使用,保留 90 天。
--   留存仅对 speech_consent_version = 2 的同意生效(旧 v1 同意不留存,仅转写)。
--
-- 执行方式(本项目无 Supabase CLI 迁移链路):
--   人工复制本文件全部内容 → Supabase 控制台 → SQL Editor → Run。
--   跑完后请让维护者在 scripts/sql/MIGRATIONS.md 登记为「已跑」(走 /sql-migrate)。
--   幂等安全:全部 IF NOT EXISTS / ON CONFLICT,可重复执行。
--
-- 回滚:
--   DROP TABLE IF EXISTS speech_recordings;
--   ALTER TABLE users DROP COLUMN IF EXISTS speech_consent_version;
--   DELETE FROM storage.buckets WHERE id = 'speech_recordings';   -- 需先清空桶内对象
--   (桶清空: 用 scripts/ops/cleanup-speech-recordings.mjs --execute 或控制台手动删)

-- ── 1. 同意版本号 (users) ─────────────────────────────────────
-- v1 同意(旧: 仅 speech_consent_at)不写此列或写 1; v2 同意写 2。留存以此为闸。
ALTER TABLE users ADD COLUMN IF NOT EXISTS speech_consent_version INT;

-- ── 2. 留存元数据表 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS speech_recordings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_code       TEXT NOT NULL,
  task_type       TEXT,                    -- "repeat" | "interview"
  item_id         TEXT,                    -- 题目 id(遥测/校准用,可空)
  storage_path    TEXT NOT NULL,           -- speech_recordings 桶内路径
  duration_ms     INT,
  consent_version INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 每用户按时间的当日计数 + 90 天清理都走这个索引
CREATE INDEX IF NOT EXISTS speech_recordings_user_created_idx
  ON speech_recordings (user_code, created_at);

-- 开 RLS 且不建任何 policy = 仅 service role 可读写(服务端 supabaseAdmin 不受影响),
-- 阻断 anon key 经 PostgREST 直查此表泄露 user_code/存储路径。
ALTER TABLE speech_recordings ENABLE ROW LEVEL SECURITY;

-- ── 3. 私有桶 ─────────────────────────────────────────────────
-- private = false 的公有桶会泄露语音,这里必须私有。读写仅经 service role
-- (服务端 /api/speech/transcribe 留存 + /api/speech/consent 撤回联动删除)。
INSERT INTO storage.buckets (id, name, public)
VALUES ('speech_recordings', 'speech_recordings', false)
ON CONFLICT (id) DO NOTHING;
