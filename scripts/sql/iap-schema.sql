-- Core schema for IAP entitlement + webhook idempotency
-- Safe to run multiple times.

create table if not exists public.iap_entitlements (
  id uuid primary key,
  user_code text not null,
  product_id text not null,
  status text not null default 'active',
  provider text not null,
  provider_ref text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists iap_entitlements_user_code_idx
  on public.iap_entitlements (user_code);

create index if not exists iap_entitlements_product_status_idx
  on public.iap_entitlements (product_id, status);

create unique index if not exists iap_entitlements_provider_ref_uniq
  on public.iap_entitlements (provider, provider_ref);

create table if not exists public.iap_webhook_events (
  id uuid primary key,
  provider text not null,
  event_id text not null,
  processed_at timestamptz not null default now()
);

create unique index if not exists iap_webhook_events_provider_event_uniq
  on public.iap_webhook_events (provider, event_id);

