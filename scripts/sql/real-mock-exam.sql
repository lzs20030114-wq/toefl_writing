-- 真题模考原子预留与永久已见账本。只允许 service_role 调用；需先执行本迁移，再部署依赖代码。
CREATE TABLE IF NOT EXISTS public.real_mock_attempts (
  id uuid PRIMARY KEY,
  user_code text NOT NULL,
  section text NOT NULL CHECK (section IN ('reading','listening','writing','speaking')),
  template_version text NOT NULL,
  snapshot jsonb NOT NULL,
  route text CHECK (route IN ('upper','lower')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','finished')),
  lease_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS real_mock_attempts_active_idx ON public.real_mock_attempts(user_code, section, status, lease_expires_at);

CREATE TABLE IF NOT EXISTS public.real_mock_keys (
  user_code text NOT NULL,
  key text NOT NULL,
  reserved_attempt uuid REFERENCES public.real_mock_attempts(id),
  lease_expires_at timestamptz,
  seen_at timestamptz,
  answered_at timestamptz,
  PRIMARY KEY (user_code, key)
);
CREATE INDEX IF NOT EXISTS real_mock_keys_reserved_idx ON public.real_mock_keys(reserved_attempt);
ALTER TABLE public.real_mock_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.real_mock_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.real_mock_attempts, public.real_mock_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.real_mock_attempts, public.real_mock_keys TO service_role;

CREATE OR REPLACE FUNCTION public.real_mock_reserve(p_user_code text, p_section text, p_attempt uuid, p_version text, p_snapshot jsonb, p_keys text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE active_row public.real_mock_attempts%ROWTYPE; k text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_code, 7062026));
  SELECT * INTO active_row FROM public.real_mock_attempts
    WHERE user_code=p_user_code AND section=p_section AND status='active' AND lease_expires_at>now()
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF active_row.template_version<>p_version THEN RETURN jsonb_build_object('status','version-conflict','attemptId',active_row.id); END IF;
    IF EXISTS (SELECT 1 FROM public.real_mock_keys WHERE reserved_attempt=active_row.id AND seen_at IS NOT NULL) THEN
      RETURN jsonb_build_object('status','active-attempt','attemptId',active_row.id);
    END IF;
    UPDATE public.real_mock_attempts SET lease_expires_at=now()+interval '2 hours' WHERE id=active_row.id;
    UPDATE public.real_mock_keys SET lease_expires_at=now()+interval '2 hours' WHERE reserved_attempt=active_row.id;
    RETURN jsonb_build_object('status','existing','snapshot',active_row.snapshot,'attemptId',active_row.id,'route',active_row.route);
  END IF;
  IF cardinality(p_keys)=0 THEN RETURN jsonb_build_object('status','expired'); END IF;
  UPDATE public.real_mock_keys SET reserved_attempt=NULL,lease_expires_at=NULL
    WHERE user_code=p_user_code AND seen_at IS NULL AND lease_expires_at<=now();
  IF EXISTS (SELECT 1 FROM public.real_mock_keys WHERE user_code=p_user_code AND key=ANY(p_keys)
             AND (seen_at IS NOT NULL OR (reserved_attempt IS NOT NULL AND lease_expires_at>now()))) THEN
    RETURN jsonb_build_object('status','collision');
  END IF;
  INSERT INTO public.real_mock_attempts(id,user_code,section,template_version,snapshot,lease_expires_at)
    VALUES(p_attempt,p_user_code,p_section,p_version,p_snapshot,now()+interval '2 hours');
  FOREACH k IN ARRAY p_keys LOOP
    INSERT INTO public.real_mock_keys(user_code,key,reserved_attempt,lease_expires_at)
      VALUES(p_user_code,k,p_attempt,now()+interval '2 hours')
      ON CONFLICT(user_code,key) DO UPDATE SET reserved_attempt=p_attempt,lease_expires_at=now()+interval '2 hours';
  END LOOP;
  RETURN jsonb_build_object('status','created','snapshot',p_snapshot,'attemptId',p_attempt);
END $$;

CREATE OR REPLACE FUNCTION public.real_mock_transition(p_user_code text, p_attempt uuid, p_action text, p_keys text[] DEFAULT ARRAY[]::text[], p_path text DEFAULT NULL, p_answered boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.real_mock_attempts%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_code, 7062026));
  SELECT * INTO a FROM public.real_mock_attempts WHERE id=p_attempt AND user_code=p_user_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','missing'); END IF;
  IF a.status='finished' THEN RETURN jsonb_build_object('status',CASE WHEN p_action='finish' THEN 'ok' ELSE 'finished' END); END IF;
  IF a.lease_expires_at<=now() AND p_action<>'finish' THEN RETURN jsonb_build_object('status','expired'); END IF;
  IF p_action='route' THEN
    IF p_path NOT IN ('upper','lower') OR (a.route IS NOT NULL AND a.route<>p_path) THEN RETURN jsonb_build_object('status','invalid-route'); END IF;
    UPDATE public.real_mock_attempts SET route=p_path,lease_expires_at=now()+interval '2 hours' WHERE id=p_attempt;
    UPDATE public.real_mock_keys SET reserved_attempt=NULL,lease_expires_at=NULL
      WHERE reserved_attempt=p_attempt AND seen_at IS NULL AND key<>ALL(p_keys);
    UPDATE public.real_mock_keys SET lease_expires_at=now()+interval '2 hours' WHERE reserved_attempt=p_attempt;
  ELSIF p_action='seen' THEN
    IF EXISTS (SELECT 1 FROM unnest(p_keys) k WHERE NOT EXISTS
      (SELECT 1 FROM public.real_mock_keys WHERE user_code=p_user_code AND key=k AND reserved_attempt=p_attempt)) THEN
      RETURN jsonb_build_object('status','invalid-key');
    END IF;
    UPDATE public.real_mock_keys SET seen_at=COALESCE(seen_at,now()),
      answered_at=CASE WHEN p_answered THEN COALESCE(answered_at,now()) ELSE answered_at END,
      lease_expires_at=now()+interval '2 hours' WHERE user_code=p_user_code AND key=ANY(p_keys);
    UPDATE public.real_mock_attempts SET lease_expires_at=now()+interval '2 hours' WHERE id=p_attempt;
    UPDATE public.real_mock_keys SET lease_expires_at=now()+interval '2 hours' WHERE reserved_attempt=p_attempt;
  ELSIF p_action='finish' THEN
    UPDATE public.real_mock_attempts SET status='finished',finished_at=now() WHERE id=p_attempt;
    UPDATE public.real_mock_keys SET reserved_attempt=NULL,lease_expires_at=NULL
      WHERE reserved_attempt=p_attempt AND seen_at IS NULL;
  ELSE RETURN jsonb_build_object('status','invalid-action'); END IF;
  RETURN jsonb_build_object('status','ok');
END $$;

REVOKE ALL ON FUNCTION public.real_mock_reserve(text,text,uuid,text,jsonb,text[]), public.real_mock_transition(text,uuid,text,text[],text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.real_mock_reserve(text,text,uuid,text,jsonb,text[]), public.real_mock_transition(text,uuid,text,text[],text,boolean) TO service_role;
