-- 真题收藏夹（题目级收藏）——跨设备镜像
-- 在 Supabase SQL Editor 里执行。可重复执行（全部 IF NOT EXISTS / 幂等授权）。
--
-- 设计说明：
--   本地 localStorage 是真源（lib/realBankFavorites.js），这张表只是跨设备镜像，
--   所以整条收藏快照存 JSONB（题型 / 题目 id / 话题 / 来源分档 / 考试日期，以后可能加字段）。
--   fav_key = 「题型:题目 id」做每用户去重，updated_at 做「谁更新谁赢」的合并。
--
-- fav JSONB 形状：
--   { key, subtype, itemId, subtitle, tier, examDate, addedAt, updatedAt, deletedAt }
--
-- 取消收藏走软删除（fav.deletedAt），行不删 —— 否则在手机上取消的收藏会被电脑上的旧副本复活。

CREATE TABLE IF NOT EXISTS real_bank_favorites (
  id BIGSERIAL PRIMARY KEY,
  user_code TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
  fav_key TEXT NOT NULL,
  fav JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_code, fav_key)
);

CREATE INDEX IF NOT EXISTS idx_real_bank_favorites_user
  ON real_bank_favorites(user_code, updated_at DESC);

ALTER TABLE real_bank_favorites ENABLE ROW LEVEL SECURITY;

-- 仅服务端 service_role 访问；不要给 PUBLIC true 策略。
REVOKE ALL ON TABLE real_bank_favorites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE real_bank_favorites TO service_role;
REVOKE ALL ON SEQUENCE real_bank_favorites_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE real_bank_favorites_id_seq TO service_role;
