-- AI credits infrastructure (staged, not connected to production flows).
--
-- Safe properties:
--   * Running this migration creates storage/RPCs only; it does not grant,
--     consume, refresh, or enforce any points by itself.
--   * All tables are RLS-protected and all RPCs are service-role only.
--   * Every mutation is atomic and idempotent.
--   * Subscription points are consumed before purchased points.
--
-- Application activation still requires BOTH:
--   CREDITS_ENABLED=true
--   CREDITS_ENFORCEMENT_ENABLED=true

BEGIN;

CREATE TABLE IF NOT EXISTS public.credit_wallets (
  user_code TEXT PRIMARY KEY REFERENCES public.users(code) ON DELETE CASCADE,
  subscription_points INTEGER NOT NULL DEFAULT 0 CHECK (subscription_points >= 0),
  purchased_points INTEGER NOT NULL DEFAULT 0 CHECK (purchased_points >= 0),
  subscription_period_start TIMESTAMPTZ NULL,
  subscription_period_end TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    subscription_period_start IS NULL
    OR subscription_period_end IS NULL
    OR subscription_period_end > subscription_period_start
  )
);

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_code TEXT NOT NULL REFERENCES public.users(code) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN (
    'subscription_refresh', 'purchase_grant', 'consume', 'refund', 'expire', 'admin_adjust'
  )),
  action TEXT NOT NULL,
  subscription_delta INTEGER NOT NULL DEFAULT 0,
  purchased_delta INTEGER NOT NULL DEFAULT 0,
  subscription_balance_after INTEGER NOT NULL CHECK (subscription_balance_after >= 0),
  purchased_balance_after INTEGER NOT NULL CHECK (purchased_balance_after >= 0),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  related_ledger_id UUID NULL REFERENCES public.credit_ledger(id),
  subscription_period_start TIMESTAMPTZ NULL,
  subscription_period_end TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    subscription_delta <> 0
    OR purchased_delta <> 0
    OR operation = 'subscription_refresh'
  )
);

CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx
  ON public.credit_ledger(user_code, created_at DESC);

CREATE INDEX IF NOT EXISTS credit_ledger_action_created_idx
  ON public.credit_ledger(action, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_one_refund_per_consume_idx
  ON public.credit_ledger(related_ledger_id)
  WHERE operation = 'refund' AND related_ledger_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_one_refresh_per_period_idx
  ON public.credit_ledger(user_code, subscription_period_start, subscription_period_end)
  WHERE operation = 'subscription_refresh';

ALTER TABLE public.credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.credit_wallets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.credit_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.credit_wallets TO service_role;
GRANT ALL ON public.credit_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.credit_wallet_snapshot(p_user_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_wallet public.credit_wallets%ROWTYPE;
  v_effective_subscription INTEGER := 0;
BEGIN
  SELECT * INTO v_wallet
  FROM public.credit_wallets
  WHERE user_code = UPPER(TRIM(p_user_code));

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'userCode', UPPER(TRIM(p_user_code)),
      'subscriptionPoints', 0,
      'purchasedPoints', 0,
      'totalPoints', 0,
      'subscriptionPeriodStart', NULL,
      'subscriptionPeriodEnd', NULL
    );
  END IF;

  v_effective_subscription := CASE
    WHEN v_wallet.subscription_period_end IS NOT NULL
      AND v_wallet.subscription_period_end <= NOW() THEN 0
    ELSE v_wallet.subscription_points
  END;

  RETURN jsonb_build_object(
    'userCode', v_wallet.user_code,
    'subscriptionPoints', v_effective_subscription,
    'storedSubscriptionPoints', v_wallet.subscription_points,
    'purchasedPoints', v_wallet.purchased_points,
    'totalPoints', v_effective_subscription + v_wallet.purchased_points,
    'subscriptionPeriodStart', v_wallet.subscription_period_start,
    'subscriptionPeriodEnd', v_wallet.subscription_period_end,
    'updatedAt', v_wallet.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_refresh_subscription(
  p_user_code TEXT,
  p_points INTEGER,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ,
  p_idempotency_key TEXT,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_code TEXT := UPPER(TRIM(p_user_code));
  v_wallet public.credit_wallets%ROWTYPE;
  v_existing public.credit_ledger%ROWTYPE;
  v_existing_period public.credit_ledger%ROWTYPE;
  v_old_points INTEGER;
  v_expire_key TEXT;
  v_ledger_id UUID;
BEGIN
  IF v_code !~ '^[A-Z0-9]{6}$' THEN RAISE EXCEPTION 'invalid user code'; END IF;
  IF p_points < 0 OR p_points > 100000 THEN RAISE EXCEPTION 'invalid point amount'; END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'invalid subscription period';
  END IF;
  IF p_period_start > NOW() THEN RAISE EXCEPTION 'subscription period has not started'; END IF;
  IF p_period_end <= NOW() THEN RAISE EXCEPTION 'subscription period has ended'; END IF;
  IF char_length(TRIM(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid idempotency key';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(TRIM(p_idempotency_key), 0));
  SELECT * INTO v_existing FROM public.credit_ledger WHERE idempotency_key = TRIM(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.user_code <> v_code
       OR v_existing.operation <> 'subscription_refresh'
       OR v_existing.subscription_period_start IS DISTINCT FROM p_period_start
       OR v_existing.subscription_period_end IS DISTINCT FROM p_period_end
       OR COALESCE((v_existing.metadata->>'allocationPoints')::INTEGER, -1) <> p_points THEN
      RAISE EXCEPTION 'idempotency key conflict';
    END IF;
    RETURN jsonb_build_object('ok', TRUE, 'duplicate', TRUE, 'wallet', public.credit_wallet_snapshot(v_code));
  END IF;

  INSERT INTO public.credit_wallets(user_code) VALUES (v_code)
  ON CONFLICT (user_code) DO NOTHING;

  SELECT * INTO v_wallet FROM public.credit_wallets WHERE user_code = v_code FOR UPDATE;
  v_old_points := v_wallet.subscription_points;

  SELECT * INTO v_existing_period
  FROM public.credit_ledger
  WHERE user_code = v_code
    AND operation = 'subscription_refresh'
    AND subscription_period_start = p_period_start
    AND subscription_period_end = p_period_end;
  IF FOUND THEN
    IF COALESCE((v_existing_period.metadata->>'allocationPoints')::INTEGER, -1) <> p_points THEN
      RAISE EXCEPTION 'subscription period allocation conflict';
    END IF;
    RETURN jsonb_build_object(
      'ok', TRUE, 'duplicate', TRUE, 'ledgerId', v_existing_period.id,
      'wallet', public.credit_wallet_snapshot(v_code)
    );
  END IF;

  IF v_wallet.subscription_period_start IS NOT NULL THEN
    IF p_period_start < v_wallet.subscription_period_start THEN
      RAISE EXCEPTION 'stale subscription period';
    END IF;
    IF p_period_start = v_wallet.subscription_period_start THEN
      RAISE EXCEPTION 'subscription period conflict';
    END IF;
  END IF;

  -- A new period replaces, rather than carries over, unused subscription points.
  -- Book expiry and grant separately so the ledger remains fully reconcilable.
  IF v_old_points > 0 THEN
    UPDATE public.credit_wallets
    SET subscription_points = 0, updated_at = NOW()
    WHERE user_code = v_code
    RETURNING * INTO v_wallet;

    v_expire_key := 'period-rollover-expire:' || v_code || ':' || EXTRACT(EPOCH FROM p_period_start)::BIGINT;
    INSERT INTO public.credit_ledger(
      user_code, operation, action, subscription_delta, purchased_delta,
      subscription_balance_after, purchased_balance_after, idempotency_key,
      subscription_period_start, subscription_period_end, metadata
    ) VALUES (
      v_code, 'expire', 'subscription_period_replaced', -v_old_points, 0,
      0, v_wallet.purchased_points, v_expire_key,
      v_wallet.subscription_period_start, v_wallet.subscription_period_end,
      jsonb_build_object('replacedByPeriodStart', p_period_start)
    );
  END IF;

  UPDATE public.credit_wallets
  SET subscription_points = p_points,
      subscription_period_start = p_period_start,
      subscription_period_end = p_period_end,
      updated_at = NOW()
  WHERE user_code = v_code
  RETURNING * INTO v_wallet;

  INSERT INTO public.credit_ledger(
    user_code, operation, action, subscription_delta, purchased_delta,
    subscription_balance_after, purchased_balance_after, idempotency_key,
    subscription_period_start, subscription_period_end, metadata
  ) VALUES (
    v_code, 'subscription_refresh', 'subscription_period_refresh', p_points, 0,
    v_wallet.subscription_points, v_wallet.purchased_points, TRIM(p_idempotency_key),
    p_period_start, p_period_end,
    COALESCE(p_metadata, '{}'::JSONB) || jsonb_build_object('allocationPoints', p_points)
  ) RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object(
    'ok', TRUE, 'duplicate', FALSE, 'ledgerId', v_ledger_id,
    'wallet', public.credit_wallet_snapshot(v_code)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_grant_purchased(
  p_user_code TEXT,
  p_points INTEGER,
  p_action TEXT,
  p_idempotency_key TEXT,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_code TEXT := UPPER(TRIM(p_user_code));
  v_wallet public.credit_wallets%ROWTYPE;
  v_existing public.credit_ledger%ROWTYPE;
  v_ledger_id UUID;
BEGIN
  IF v_code !~ '^[A-Z0-9]{6}$' THEN RAISE EXCEPTION 'invalid user code'; END IF;
  IF p_points < 1 OR p_points > 100000 THEN RAISE EXCEPTION 'invalid point amount'; END IF;
  IF char_length(TRIM(p_action)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid action'; END IF;
  IF char_length(TRIM(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid idempotency key'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(TRIM(p_idempotency_key), 0));
  SELECT * INTO v_existing FROM public.credit_ledger WHERE idempotency_key = TRIM(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.user_code <> v_code
       OR v_existing.operation <> 'purchase_grant'
       OR v_existing.action <> TRIM(p_action)
       OR v_existing.purchased_delta <> p_points THEN
      RAISE EXCEPTION 'idempotency key conflict';
    END IF;
    RETURN jsonb_build_object('ok', TRUE, 'duplicate', TRUE, 'wallet', public.credit_wallet_snapshot(v_code));
  END IF;

  INSERT INTO public.credit_wallets(user_code) VALUES (v_code)
  ON CONFLICT (user_code) DO NOTHING;

  UPDATE public.credit_wallets
  SET purchased_points = purchased_points + p_points, updated_at = NOW()
  WHERE user_code = v_code
  RETURNING * INTO v_wallet;

  INSERT INTO public.credit_ledger(
    user_code, operation, action, subscription_delta, purchased_delta,
    subscription_balance_after, purchased_balance_after, idempotency_key, metadata
  ) VALUES (
    v_code, 'purchase_grant', TRIM(p_action), 0, p_points,
    v_wallet.subscription_points, v_wallet.purchased_points, TRIM(p_idempotency_key), COALESCE(p_metadata, '{}'::JSONB)
  ) RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object(
    'ok', TRUE, 'duplicate', FALSE, 'ledgerId', v_ledger_id,
    'wallet', public.credit_wallet_snapshot(v_code)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_consume(
  p_user_code TEXT,
  p_points INTEGER,
  p_action TEXT,
  p_idempotency_key TEXT,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_code TEXT := UPPER(TRIM(p_user_code));
  v_wallet public.credit_wallets%ROWTYPE;
  v_existing public.credit_ledger%ROWTYPE;
  v_subscription_used INTEGER := 0;
  v_purchased_used INTEGER := 0;
  v_expired INTEGER := 0;
  v_ledger_id UUID;
BEGIN
  IF v_code !~ '^[A-Z0-9]{6}$' THEN RAISE EXCEPTION 'invalid user code'; END IF;
  IF p_points < 1 OR p_points > 100000 THEN RAISE EXCEPTION 'invalid point amount'; END IF;
  IF char_length(TRIM(p_action)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid action'; END IF;
  IF char_length(TRIM(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid idempotency key'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(TRIM(p_idempotency_key), 0));
  SELECT * INTO v_existing FROM public.credit_ledger WHERE idempotency_key = TRIM(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.user_code <> v_code
       OR v_existing.operation <> 'consume'
       OR v_existing.action <> TRIM(p_action)
       OR -(v_existing.subscription_delta + v_existing.purchased_delta) <> p_points THEN
      RAISE EXCEPTION 'idempotency key conflict';
    END IF;
    RETURN jsonb_build_object(
      'ok', TRUE, 'allowed', TRUE, 'duplicate', TRUE,
      'wallet', public.credit_wallet_snapshot(v_code)
    );
  END IF;

  INSERT INTO public.credit_wallets(user_code) VALUES (v_code)
  ON CONFLICT (user_code) DO NOTHING;
  SELECT * INTO v_wallet FROM public.credit_wallets WHERE user_code = v_code FOR UPDATE;

  IF v_wallet.subscription_period_end IS NOT NULL
     AND v_wallet.subscription_period_end <= NOW()
     AND v_wallet.subscription_points > 0 THEN
    v_expired := v_wallet.subscription_points;
    UPDATE public.credit_wallets
    SET subscription_points = 0, updated_at = NOW()
    WHERE user_code = v_code
    RETURNING * INTO v_wallet;

    INSERT INTO public.credit_ledger(
      user_code, operation, action, subscription_delta, purchased_delta,
      subscription_balance_after, purchased_balance_after, idempotency_key, metadata
    ) VALUES (
      v_code, 'expire', 'subscription_period_expired', -v_expired, 0,
      0, v_wallet.purchased_points,
      'auto-expire:' || v_code || ':' || EXTRACT(EPOCH FROM v_wallet.subscription_period_end)::BIGINT,
      jsonb_build_object('periodEnd', v_wallet.subscription_period_end)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  IF v_wallet.subscription_points + v_wallet.purchased_points < p_points THEN
    RETURN jsonb_build_object(
      'ok', TRUE, 'allowed', FALSE, 'duplicate', FALSE, 'requiredPoints', p_points,
      'wallet', public.credit_wallet_snapshot(v_code)
    );
  END IF;

  v_subscription_used := LEAST(v_wallet.subscription_points, p_points);
  v_purchased_used := p_points - v_subscription_used;

  UPDATE public.credit_wallets
  SET subscription_points = subscription_points - v_subscription_used,
      purchased_points = purchased_points - v_purchased_used,
      updated_at = NOW()
  WHERE user_code = v_code
  RETURNING * INTO v_wallet;

  INSERT INTO public.credit_ledger(
    user_code, operation, action, subscription_delta, purchased_delta,
    subscription_balance_after, purchased_balance_after, idempotency_key,
    subscription_period_start, subscription_period_end, metadata
  ) VALUES (
    v_code, 'consume', TRIM(p_action), -v_subscription_used, -v_purchased_used,
    v_wallet.subscription_points, v_wallet.purchased_points, TRIM(p_idempotency_key),
    v_wallet.subscription_period_start, v_wallet.subscription_period_end,
    COALESCE(p_metadata, '{}'::JSONB)
  ) RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object(
    'ok', TRUE, 'allowed', TRUE, 'duplicate', FALSE, 'ledgerId', v_ledger_id,
    'subscriptionPointsUsed', v_subscription_used, 'purchasedPointsUsed', v_purchased_used,
    'wallet', public.credit_wallet_snapshot(v_code)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_refund(
  p_user_code TEXT,
  p_original_idempotency_key TEXT,
  p_idempotency_key TEXT,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_code TEXT := UPPER(TRIM(p_user_code));
  v_original public.credit_ledger%ROWTYPE;
  v_existing_refund public.credit_ledger%ROWTYPE;
  v_wallet public.credit_wallets%ROWTYPE;
  v_subscription_refund INTEGER;
  v_purchased_refund INTEGER;
  v_subscription_refund_converted BOOLEAN := FALSE;
  v_ledger_id UUID;
BEGIN
  IF v_code !~ '^[A-Z0-9]{6}$' THEN RAISE EXCEPTION 'invalid user code'; END IF;
  IF char_length(TRIM(p_original_idempotency_key)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid original idempotency key'; END IF;
  IF char_length(TRIM(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid idempotency key'; END IF;

  -- Serialize every refund attempt for the same original consumption, even if
  -- callers accidentally retry with a different refund idempotency key.
  PERFORM pg_advisory_xact_lock(hashtextextended('credit-refund:' || TRIM(p_original_idempotency_key), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(TRIM(p_idempotency_key), 0));
  SELECT * INTO v_original FROM public.credit_ledger
  WHERE user_code = v_code
    AND idempotency_key = TRIM(p_original_idempotency_key)
    AND operation = 'consume';
  IF NOT FOUND THEN RAISE EXCEPTION 'original consumption not found'; END IF;

  SELECT * INTO v_existing_refund FROM public.credit_ledger
  WHERE idempotency_key = TRIM(p_idempotency_key);
  IF FOUND THEN
    IF v_existing_refund.user_code <> v_code
       OR v_existing_refund.operation <> 'refund'
       OR v_existing_refund.related_ledger_id <> v_original.id THEN
      RAISE EXCEPTION 'idempotency key conflict';
    END IF;
    RETURN jsonb_build_object('ok', TRUE, 'duplicate', TRUE, 'wallet', public.credit_wallet_snapshot(v_code));
  END IF;

  SELECT * INTO v_existing_refund FROM public.credit_ledger
  WHERE operation = 'refund' AND related_ledger_id = v_original.id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', TRUE, 'duplicate', TRUE, 'wallet', public.credit_wallet_snapshot(v_code));
  END IF;

  v_subscription_refund := -v_original.subscription_delta;
  v_purchased_refund := -v_original.purchased_delta;

  SELECT * INTO v_wallet FROM public.credit_wallets WHERE user_code = v_code FOR UPDATE;

  -- Subscription credits belong to one period and must never inflate a later
  -- period. A delayed refund remains valuable to the user, but becomes
  -- non-expiring purchased credit when the original period is no longer active.
  IF v_subscription_refund > 0 AND (
       v_original.subscription_period_start IS NULL
       OR v_original.subscription_period_end IS NULL
       OR v_original.subscription_period_end <= NOW()
       OR v_wallet.subscription_period_start IS DISTINCT FROM v_original.subscription_period_start
       OR v_wallet.subscription_period_end IS DISTINCT FROM v_original.subscription_period_end
     ) THEN
    v_purchased_refund := v_purchased_refund + v_subscription_refund;
    v_subscription_refund := 0;
    v_subscription_refund_converted := TRUE;
  END IF;

  UPDATE public.credit_wallets
  SET subscription_points = subscription_points + v_subscription_refund,
      purchased_points = purchased_points + v_purchased_refund,
      updated_at = NOW()
  WHERE user_code = v_code
  RETURNING * INTO v_wallet;

  INSERT INTO public.credit_ledger(
    user_code, operation, action, subscription_delta, purchased_delta,
    subscription_balance_after, purchased_balance_after, idempotency_key,
    related_ledger_id, subscription_period_start, subscription_period_end, metadata
  ) VALUES (
    v_code, 'refund', 'automatic_refund', v_subscription_refund, v_purchased_refund,
    v_wallet.subscription_points, v_wallet.purchased_points, TRIM(p_idempotency_key),
    v_original.id, v_original.subscription_period_start, v_original.subscription_period_end,
    COALESCE(p_metadata, '{}'::JSONB) || jsonb_build_object(
      'subscriptionRefundConvertedToPurchased', v_subscription_refund_converted
    )
  ) RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object(
    'ok', TRUE, 'duplicate', FALSE, 'ledgerId', v_ledger_id,
    'refundedLedgerId', v_original.id,
    'wallet', public.credit_wallet_snapshot(v_code)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.credit_wallet_snapshot(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_refresh_subscription(TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_grant_purchased(TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_consume(TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_refund(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.credit_wallet_snapshot(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_refresh_subscription(TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_grant_purchased(TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_consume(TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_refund(TEXT, TEXT, TEXT, JSONB) TO service_role;

COMMIT;
