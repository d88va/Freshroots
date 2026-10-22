-- 010: how big a gap between the learned monthly pattern and the active season factor counts as "sharp".
-- Only decides which suggestion cards are shown. It changes no factor and no flag.

insert into rule_settings (key, value) values ('season_gap_threshold', '0.15') on conflict (key) do nothing;
