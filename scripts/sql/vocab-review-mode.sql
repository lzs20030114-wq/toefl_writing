-- 阅读/听力复习共用日志表；旧日志默认归为阅读。
-- 可重复执行。上线写 mode 的 API 前先运行。
ALTER TABLE vocab_review_logs
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'reading';

-- 历史行及旧客户端未传 mode 的写入都由默认值补为 reading。
UPDATE vocab_review_logs SET mode = 'reading' WHERE mode IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vocab_review_logs_mode_check'
  ) THEN
    ALTER TABLE vocab_review_logs
      ADD CONSTRAINT vocab_review_logs_mode_check CHECK (mode IN ('reading', 'listening'));
  END IF;
END $$;
