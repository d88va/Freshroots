-- 001: the data that comes in from SAP and Zoho exports (or the seed files), plus the event log.

create table if not exists skus (
  sku_id             text primary key,
  name               text not null,
  category           text not null,
  is_perishable      boolean not null default false,
  standard_order_qty integer not null check (standard_order_qty > 0),
  launch_date        date
);

-- One row per SKU per week, company-wide (distributor rows are summed on import).
-- A missing week means "no data" (a gap). A week with zero sales is stored as units = 0.
create table if not exists weekly_sales (
  sku_id     text not null references skus(sku_id) on delete cascade,
  week_start date not null,
  units      integer not null check (units >= 0),
  primary key (sku_id, week_start)
);

create table if not exists stock_snapshots (
  sku_id        text not null references skus(sku_id) on delete cascade,
  snapshot_date date not null,
  units_on_hand integer not null check (units_on_hand >= 0),
  primary key (sku_id, snapshot_date)
);

-- Context only. Never used in any calculation.
create table if not exists open_pos (
  id            bigint generated always as identity primary key,
  sku_id        text not null references skus(sku_id) on delete cascade,
  qty           integer not null check (qty > 0),
  expected_date date not null
);

-- Past stockouts and write-offs. Used by the backtest and the outcome check.
create table if not exists loss_events (
  id         bigint generated always as identity primary key,
  sku_id     text not null references skus(sku_id) on delete cascade,
  week_start date not null,
  type       text not null check (type in ('stockout', 'write_off')),
  value_inr  numeric(12, 2) not null check (value_inr >= 0),
  unique (sku_id, week_start, type)
);

-- Festivals move every year, so dated events live here. Raghav can log his own events too.
create table if not exists calendar_events (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('festival', 'own_scheme', 'competitor_scheme', 'other')),
  name       text not null,
  start_date date not null,
  end_date   date not null,
  note       text,
  logged_by  text not null default 'raghav',
  check (end_date >= start_date),
  unique (kind, name, start_date)
);

-- A line for every file imported, so the Import page can show what was loaded and when.
create table if not exists import_log (
  id            bigint generated always as identity primary key,
  imported_at   timestamptz not null default now(),
  kind          text not null,
  filename      text,
  rows_read     integer not null,
  rows_saved    integer not null,
  rows_rejected integer not null
);

create index if not exists weekly_sales_week_idx on weekly_sales (week_start);
create index if not exists loss_events_week_idx on loss_events (week_start);
