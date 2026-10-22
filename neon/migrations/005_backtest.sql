-- 005: backtest (kill switch K2). Results are stored so the page opens fast and the number is not recomputed on every visit.

create table if not exists backtest_results (
  id      bigint generated always as identity primary key,
  run_at  timestamptz not null default now(),
  params  jsonb not null,
  summary jsonb not null
);

insert into rule_settings (key, value) values
  ('backtest_lookback_weeks',  '8'),   -- a loss counts as caught if a matching flag came in the 8 weeks before it
  ('backtest_min_lead_weeks',  '1')    -- ...and at least 1 week before, so there was time to act
on conflict (key) do nothing;
