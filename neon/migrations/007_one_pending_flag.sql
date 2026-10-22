-- 007: a SKU can have only ONE pending flag at a time. The database enforces it, so running the rules
-- twice (cron, Run now, a re-upload) can never put the same SKU in front of Raghav twice.

create unique index if not exists flags_one_pending_per_sku on flags (sku_id) where status = 'pending';
