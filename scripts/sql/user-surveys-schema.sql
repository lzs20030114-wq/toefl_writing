-- user_surveys: one-time product surveys (e.g. first-set-completion)
--
-- Existence of a row (any status) means "we already asked this user", so
-- frontend will not pop the modal again. status='submitted' rows carry the
-- actual responses JSON; status='dismissed' rows record that the user closed
-- the modal without submitting.

create table if not exists user_surveys (
  id           bigint generated always as identity primary key,
  user_code    text not null,
  survey_type  text not null,
  status       text not null check (status in ('submitted','dismissed')),
  responses    jsonb,
  created_at   timestamptz not null default now(),
  unique (user_code, survey_type)
);

create index if not exists idx_user_surveys_user_code on user_surveys (user_code);

-- RLS: block direct public access (only service role writes via API)
alter table user_surveys enable row level security;
