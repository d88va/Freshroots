-- 004: suggestions from the feedback loop, and the Pause switch.

create table if not exists suggestions (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  rule_key   text not null,
  evidence   jsonb not null,
  text       text not null,
  status     text not null default 'open' check (status in ('open', 'accepted', 'edited', 'dismissed'))
);

-- Exactly one row. Paused means no cron runs and no Run now. Existing flags stay visible.
create table if not exists system_state (
  id            integer primary key default 1 check (id = 1),
  paused        boolean not null default false,
  paused_at     timestamptz,
  paused_reason text
);
insert into system_state (id) values (1) on conflict do nothing;

create table if not exists pause_log (
  id     bigint generated always as identity primary key,
  action text not null check (action in ('pause', 'resume')),
  at     timestamptz not null default now(),
  reason text not null
);
