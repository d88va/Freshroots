-- 008: richer run records, and the setting that stops a SKU being flagged again straight after Raghav decided it.

alter table runs drop constraint if exists runs_status_check;
alter table runs add constraint runs_status_check check (status in ('running', 'succeeded', 'failed', 'blocked', 'skipped'));

alter table runs
  add column if not exists run_date date,
  add column if not exists flagged_total integer,      -- SKUs the rules flagged on this run
  add column if not exists flags_new integer,          -- new pending flags created
  add column if not exists flags_refreshed integer,    -- pending flags whose numbers changed and were updated in place
  add column if not exists flags_unchanged integer,    -- pending flags that were already up to date
  add column if not exists flags_held integer,         -- not flagged again: decided in the last few days
  add column if not exists ai_reasons integer,
  add column if not exists note text;

-- After Raghav approves, edits or overrides a SKU, it is not flagged again for this many days (0 = off).
-- Without it, the stock has not arrived yet, so the next run would flag the same SKU again and invite a double order.
insert into rule_settings (key, value) values ('reflag_cooldown_days', '7') on conflict (key) do nothing;
