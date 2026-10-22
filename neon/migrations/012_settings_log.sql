-- 012: project and kill-criteria settings get their own change log (rule changes stay in rule_versions), and three new settings.

create table if not exists project_setting_log (
  id       bigint generated always as identity primary key,
  saved_at timestamptz not null default now(),
  saved_by text not null default 'raghav',
  changes  jsonb not null,
  reason   text not null
);

insert into rule_settings (key, value) values
  ('k1_export_automated', 'false'),   -- the owner confirms this once IT has a scheduled SAP export running
  ('k2_amber_margin',     '10'),      -- K2 shows amber when the catch rate is within this many points above its stop line
  ('k4_target_pct',       '25')       -- the outcome target from the pre-build map: recover at least 25% of the quarterly loss
on conflict (key) do nothing;
