-- 单词本并发控制。先执行 vocab-sync-hardening.sql，再部署新版 /api/vocab。
-- 旧 API 或其他服务更新时也自动递增 version，防止部署切换期绕过 CAS。
-- 可重复执行，原有卡片与复习进度不变。

BEGIN;

ALTER TABLE public.vocab_cards ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.vocab_cards_bump_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.vocab_cards_bump_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vocab_cards_bump_version() TO service_role;

DROP TRIGGER IF EXISTS trg_vocab_cards_bump_version ON public.vocab_cards;
CREATE TRIGGER trg_vocab_cards_bump_version
BEFORE UPDATE ON public.vocab_cards
FOR EACH ROW EXECUTE FUNCTION public.vocab_cards_bump_version();

COMMIT;
