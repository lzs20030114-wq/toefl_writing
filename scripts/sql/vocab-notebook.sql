-- 单词本（Vocabulary Notebook）——划词词典收藏的词 + 间隔重复复习进度
-- 在 Supabase SQL Editor 里执行。
-- 新环境接着执行 vocab-sync-hardening.sql 与 vocab-cas-version.sql，
-- 后者提供新版 /api/vocab 条件写入所需的 version/trigger。
--
-- 设计说明：
--   本地 localStorage 是真源，这张表只是跨设备镜像，所以整张卡片存 JSONB
--   （SRS 字段还会随算法调整而变，每加一个字段跑一次迁移不值当）。
--   word 和 updated_at 提成列：word 用来做每用户去重，updated_at 用来做
--   「谁更新谁赢」的增量合并。
--
-- card JSONB 形状（见 lib/vocab/book.js 的 normalizeCard）：
--   { word, display, phonetic, def, tag, sentence, source,
--     createdAt, updatedAt, introducedAt, deletedAt,
--     state, step, stability, difficulty, due, lastReview, reps, lapses, scheduledDays }
--
-- 注意：取消收藏走软删除（card.deletedAt），行不删 —— 否则「在手机上删掉的词」
-- 会在下次同步时被电脑上的旧副本复活。真正的删除只发生在用户「清空单词本」时。

CREATE TABLE IF NOT EXISTS vocab_cards (
  id BIGSERIAL PRIMARY KEY,
  user_code TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
  word TEXT NOT NULL,
  card JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_code, word)
);

CREATE INDEX IF NOT EXISTS idx_vocab_cards_user
  ON vocab_cards(user_code, updated_at DESC);

ALTER TABLE vocab_cards ENABLE ROW LEVEL SECURITY;

-- 仅服务端 service_role 访问；不要给 PUBLIC true 策略。
REVOKE ALL ON TABLE vocab_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE vocab_cards TO service_role;
REVOKE ALL ON SEQUENCE vocab_cards_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE vocab_cards_id_seq TO service_role;

-- ── 复习日志 ───────────────────────────────────────────────────────────
-- 每打一次分一行。当下没人读它；它的全部价值在以后：
--   1) 用 fsrs-optimizer 在我们自己的日志上重拟合 FSRS 权重，替换 lib/vocab/srs.js
--      里的 DEFAULT_W（群体拟合，不是每人一套）
--   2) 留存率校准监控：实际到期时的回忆率 vs 目标 0.90 的偏差
-- 这两件事都**无法事后补数据**，所以从功能上线第一天就开始收。

CREATE TABLE IF NOT EXISTS vocab_review_logs (
  id BIGSERIAL PRIMARY KEY,
  user_code TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
  word TEXT NOT NULL,
  -- 1=Again 2=Hard 3=Good 4=Easy。UI 只发 1 和 3（二档），2/4 预留。
  rating SMALLINT NOT NULL,
  -- 打分**之前**卡片所处的状态
  state TEXT NOT NULL,
  -- 距上次复习过了多少天（拟合必需）
  elapsed_days DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- 这次打分后排了多少天
  scheduled_days INT NOT NULL DEFAULT 0,
  stability DOUBLE PRECISION NULL,
  difficulty DOUBLE PRECISION NULL,
  -- 这张卡从显示到打分花了多久，留给「用反应时间做隐式分档」那条后续优化
  duration_ms INT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 网络重试重复推送时去重；同一个词同一毫秒不可能复习两次
  UNIQUE (user_code, word, reviewed_at)
);

CREATE INDEX IF NOT EXISTS idx_vocab_review_logs_user
  ON vocab_review_logs(user_code, reviewed_at DESC);

ALTER TABLE vocab_review_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE vocab_review_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE vocab_review_logs TO service_role;
REVOKE ALL ON SEQUENCE vocab_review_logs_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE vocab_review_logs_id_seq TO service_role;
