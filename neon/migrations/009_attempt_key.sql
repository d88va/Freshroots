-- 009: Gemini allowances are per Google project, so the daily call count is kept per key.
-- key_id is a short fingerprint of the key (never the key itself).

alter table reason_attempts add column if not exists key_id text;
