-- 真题自动录入（后台拖入 → 云端 Worker → 自动上线）的任务表。
--
-- 一个 job = 一套真题源文件的一次录入。后台 /admin-real-bank-ingest 建 job，
-- 浏览器直传源文件到 Storage 桶 real_bank_sources/jobs/<id>/，
-- 然后 workflow_dispatch real-bank-ingest.yml，GitHub Actions 上的
-- scripts/realbank/worker.mjs 用 service role 直接读写这张表推进 stage/progress。
--
-- 契约见 docs/realbank-ingest-contract.md §1。
-- RLS 开启但不建 policy：只有 service role 能读写（和 audio_events 一致）。
--
-- Run in Supabase SQL Editor. 幂等，可重复执行。

CREATE TABLE IF NOT EXISTS real_bank_ingest_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_name    TEXT NOT NULL,                        -- 用户给的套名，也是源目录名
  set_key     TEXT NULL,                            -- Worker 派生的产物 key
  kind        TEXT NOT NULL DEFAULT 'ingest',       -- ingest | rebuild
  source_kind TEXT NOT NULL DEFAULT 'auto',         -- auto | first_pdf | vendor_docx | screenshot_docx
  detected_kind TEXT NULL,                          -- Worker 探测结果
  status      TEXT NOT NULL DEFAULT 'uploading',    -- uploading queued dispatched running needs_format done failed cancelled
  stage       TEXT NULL,                            -- pull_artifacts download detect ingest structure audit asr merge_audio bs_extract build audio images counts push push_artifacts cleanup
  progress    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ts, stage, msg, level}]
  files       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{path, size, uploaded}]
  cost_cny    NUMERIC NOT NULL DEFAULT 0,
  result      JSONB NULL,                           -- 见契约 §5
  error       TEXT NULL,
  gh_run_id   TEXT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 列表页按 (状态, 时间倒序) 翻；补建列以便老库重跑本文件也能对齐。
ALTER TABLE real_bank_ingest_jobs ADD COLUMN IF NOT EXISTS set_key TEXT NULL;
ALTER TABLE real_bank_ingest_jobs ADD COLUMN IF NOT EXISTS detected_kind TEXT NULL;
ALTER TABLE real_bank_ingest_jobs ADD COLUMN IF NOT EXISTS gh_run_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_rb_ingest_jobs_status_created
  ON real_bank_ingest_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rb_ingest_jobs_created
  ON real_bank_ingest_jobs(created_at DESC);

-- RLS：开启但不建任何 policy = 匿名/登录用户都读写不到，只有 service role 绕过。
ALTER TABLE real_bank_ingest_jobs ENABLE ROW LEVEL SECURITY;

-- 让 PostgREST 立刻看到新表，迁移跑完不用等缓存过期。
NOTIFY pgrst, 'reload schema';
