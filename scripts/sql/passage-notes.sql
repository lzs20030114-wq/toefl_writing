-- 原文批注笔记（练后记录里选中原文提问，回答留成笔记）——跨设备镜像
-- 在 Supabase SQL Editor 里执行。可重复执行（全部 IF NOT EXISTS / 幂等授权）。
--
-- 设计说明：
--   本地 localStorage 是真源（lib/notes/noteStore.js），这张表只是跨设备镜像，
--   所以整条笔记存 JSONB（提问轮次、高亮定位字段以后还会变）。
--   note_id 做每用户去重，passage_key 是文章签名（同一篇文章的笔记一起取），
--   updated_at 做「谁更新谁赢」的合并。
--
-- note JSONB 形状（见 lib/notes/passageNotes.js 的 makeNote）：
--   { id, passageKey, quote, sentenceText, start, source,
--     turns: [{ q, a, presetId, at, dict }], createdAt, updatedAt, deletedAt }
--
-- 删除走软删除（note.deletedAt），行不删 —— 否则在手机上删掉的笔记会被电脑上的旧副本复活。

CREATE TABLE IF NOT EXISTS passage_notes (
  id BIGSERIAL PRIMARY KEY,
  user_code TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
  note_id TEXT NOT NULL,
  passage_key TEXT NOT NULL,
  note JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_code, note_id)
);

CREATE INDEX IF NOT EXISTS idx_passage_notes_user
  ON passage_notes(user_code, updated_at DESC);

ALTER TABLE passage_notes ENABLE ROW LEVEL SECURITY;

-- 仅服务端 service_role 访问；不要给 PUBLIC true 策略。
REVOKE ALL ON TABLE passage_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE passage_notes TO service_role;
REVOKE ALL ON SEQUENCE passage_notes_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE passage_notes_id_seq TO service_role;
