-- 002: Raghav's rules as settings, with a version history. The system never writes here by itself.
-- A setting changes only when Raghav saves it on the Settings page or accepts a suggestion.

create table if not exists rule_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- One row per save: what changed (old and new values per key), who, and why.
create table if not exists rule_versions (
  id       bigint generated always as identity primary key,
  saved_at timestamptz not null default now(),
  saved_by text not null default 'raghav',
  changes  jsonb not null,
  reason   text
);

insert into rule_settings (key, value) values
  -- the five rules
  ('high_demand_pct',            '20'),          -- last 4 weeks this % above the 12-week average
  ('high_demand_multiplier',     '1.5'),         -- recommended qty = this x standard order qty
  ('recent_weeks',               '4'),
  ('baseline_weeks',             '12'),
  ('stockout_weeks',             '6'),
  ('overstock_weeks',            '14'),
  ('perishable_min_weeks',       '3'),           -- replaces the 6 week limit for perishables
  ('perishable_max_weeks',       '4'),           -- replaces the 14 week limit for perishables
  -- season factor
  ('season_months',              '[10, 11, 3]'),
  ('season_uplift',              '1.25'),
  ('season_mode',                '"baseline"'),  -- "baseline" or "weeks_check_only" (open question for Raghav)
  -- needs_judgment triggers (proposals, to confirm with Raghav)
  ('judgment_min_history_weeks', '12'),
  ('judgment_max_missing_weeks', '0'),           -- missing weeks allowed inside the last 12
  ('judgment_ratio_high',        '2'),
  ('judgment_ratio_low',         '0.5'),
  -- feedback loop
  ('suggest_override_count',     '10'),          -- overrides of one rule in a month that trigger a suggestion
  ('outcome_check_days',         '28'),
  -- kill criteria (they only display status; stopping is the owner's decision)
  ('project_start_date',         '"2026-10-22"'),
  ('go_live_date',               'null'),
  ('k1_day',                     '30'),
  ('k2_min_catch_pct',           '50'),
  ('k3_override_pct',            '30'),
  ('k3_after_weeks',             '6'),
  ('k3_amber_pct',               '20'),
  ('k4_quarters',                '2')
on conflict (key) do nothing;

insert into rule_versions (saved_by, changes, reason)
select 'system', '{"initial": "default values from the case brief and the owner''s resolutions"}'::jsonb, 'Initial defaults'
where not exists (select 1 from rule_versions);
