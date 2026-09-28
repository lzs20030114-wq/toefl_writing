-- 单词本权限止血；可独立、重复执行，不改动用户数据。
-- 可以先于应用代码部署执行。并发版本设施另见 vocab-cas-version.sql。

BEGIN;

-- 两张表只由服务端 service_role 访问。删掉旧的 PUBLIC true 策略；即使另有
-- 后来新增的策略，撤销表权限也会阻止 anon/authenticated 直接读写。
DROP POLICY IF EXISTS "Allow all operations on vocab_cards" ON public.vocab_cards;
DROP POLICY IF EXISTS "Allow all operations on vocab_review_logs" ON public.vocab_review_logs;
ALTER TABLE public.vocab_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vocab_review_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vocab_cards, public.vocab_review_logs FROM PUBLIC, anon, authenticated;

-- BIGSERIAL 序列可能由不同安装路径创建，按依赖关系找，不假设序列名称。
DO $$
DECLARE
  seq regclass;
BEGIN
  FOR seq IN
    SELECT pg_get_serial_sequence('public.' || c.relname, 'id')::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('vocab_cards', 'vocab_review_logs')
      AND c.relkind IN ('r', 'p')
  LOOP
    IF seq IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', seq);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', seq);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vocab_cards, public.vocab_review_logs TO service_role;

COMMIT;
