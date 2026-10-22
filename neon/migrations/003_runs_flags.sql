-- 003: runs, flags, Raghav's decisions and the outcome checks.

create table if not exists runs (
  id           bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  trigger      text not null check (trigger in ('cron', 'manual', 'upload')),
  status       text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  flags_raised integer not null default 0,
  error        text
);

-- One row per SKU per run. If a SKU triggers several rules, flag_type is the main one and
-- also_types lists the rest (for example high_demand + stockout_risk, marked urgent).
create table if not exists flags (
  id              bigint generated always as identity primary key,
  run_id          bigint not null references runs(id) on delete cascade,
  sku_id          text not null references skus(sku_id) on delete cascade,
  flag_type       text not null check (flag_type in
                    ('high_demand', 'stockout_risk', 'overstock_risk', 'needs_judgment')),
  also_types      text[] not null default '{}',
  urgent          boolean not null default false,
  recommended_qty integer,                        -- null for overstock (pause) and needs_judgment
  numbers         jsonb not null,                 -- every figure behind the flag
  reason          text,
  reason_source   text check (reason_source in ('ai', 'template')),
  status          text not null default 'pending' check (status in
                    ('pending', 'approved', 'edited', 'overridden')),
  final_qty       integer,
  decision_tag    text check (decision_tag in
                    ('season_missed', 'new_launch', 'competitor_scheme', 'data_wrong', 'other')),
  override_reason text,                           -- free text, required when the tag is "other"
  reason_rating   text check (reason_rating in ('up', 'down')),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  -- an override must always carry a tag
  check (status <> 'overridden' or decision_tag is not null),
  check (decision_tag <> 'other' or status = 'pending' or (override_reason is not null and length(trim(override_reason)) > 0))
);

create index if not exists flags_status_idx on flags (status);
create index if not exists flags_sku_idx on flags (sku_id, status);

-- Daily check on flags decided 28+ days ago.
--   approved_end_state: where stock ended up. Never called right or wrong (the order changed the result).
--   override_check:     did the feared stockout or write-off happen anyway? (Raghav right or wrong)
--   miss:               a loss event with no flag on that SKU in the 4 weeks before it
create table if not exists outcomes (
  id         bigint generated always as identity primary key,
  flag_id    bigint references flags(id) on delete cascade,   -- null for a miss
  checked_at timestamptz not null default now(),
  kind       text not null check (kind in ('approved_end_state', 'override_check', 'miss')),
  result     text not null,
  detail     jsonb not null default '{}'
);
create index if not exists outcomes_flag_idx on outcomes (flag_id);
