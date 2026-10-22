-- 006: AI reasons. Every flag always has a reason; reason_source says who wrote it and
-- reason_fallback says why a template was used instead of the AI.

alter table flags add column if not exists reason_fallback text check (reason_fallback in
  ('not_yet', 'no_key', 'api_error', 'rate_limited', 'timeout', 'blocked', 'number_check', 'format_check'));

-- A log of every attempt to get a reason from Gemini, including the ones that were thrown away.
create table if not exists reason_attempts (
  id         bigint generated always as identity primary key,
  flag_id    bigint not null references flags(id) on delete cascade,
  at         timestamptz not null default now(),
  outcome    text not null,          -- accepted, or the fallback kind
  model      text,
  latency_ms integer,
  ai_text    text,                   -- what the AI wrote (kept even when rejected, so rejections can be inspected)
  detail     text
);
create index if not exists reason_attempts_flag_idx on reason_attempts (flag_id);
