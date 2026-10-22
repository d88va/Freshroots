-- 013: "today" for the app. Empty in real use. The demo data is frozen in October 2026, so for a demo the runs and the
-- Metrics page pretend today is this date. Otherwise, a few days later, the newest week of sales would be missing for every SKU.

insert into rule_settings (key, value) values ('run_date_override', 'null') on conflict (key) do nothing;
