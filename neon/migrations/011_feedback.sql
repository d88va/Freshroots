-- 011: the feedback loop. Outcome checks, suggestions that Raghav can accept, edit or dismiss, and which rule version each run used.

-- An outcome is recorded once: once per decided flag (end state or override check), once per missed loss.
create unique index if not exists outcomes_one_per_flag on outcomes (flag_id) where flag_id is not null;
create unique index if not exists outcomes_one_per_miss on outcomes ((detail->>'loss_event_id')) where kind = 'miss';

alter table suggestions
  add column if not exists dedupe_key text,            -- the same suggestion (rule or tag, month) is never created twice, even after dismissal
  add column if not exists proposal jsonb,             -- {key, from, to} when the evidence points to a specific change
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution jsonb;           -- {version_id, by, reason, key, value} or {reason} for a dismissal
create unique index if not exists suggestions_dedupe on suggestions (dedupe_key) where dedupe_key is not null;

alter table runs add column if not exists rule_version_id bigint;   -- the rule version this run used

insert into rule_settings (key, value) values ('suggest_tag_count', '10') on conflict (key) do nothing;
