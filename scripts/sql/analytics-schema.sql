-- page_views: lightweight analytics tracking
create table if not exists page_views (
  id         bigint generated always as identity primary key,
  path       text not null,
  referrer   text,
  user_code  text,
  created_at timestamptz not null default now()
);

-- Index for time-range queries (admin dashboard)
create index if not exists idx_page_views_created_at on page_views (created_at desc);

-- Index for top-pages aggregation
create index if not exists idx_page_views_path on page_views (path);

-- RLS: block direct public access (only service role writes via API)
alter table page_views enable row level security;
-- No public policies = public can't read/write directly
