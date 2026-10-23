-- 014: the Zoho Inventory connection. Approved orders can be sent to Zoho as DRAFT purchase orders.
-- The system never issues a purchase order: procurement reviews and places each draft in Zoho.

-- Which Zoho item a SKU is, so it is looked up once.
create table if not exists zoho_items (
  sku_id       text primary key references skus(sku_id) on delete cascade,
  zoho_item_id text not null,
  cached_at    timestamptz not null default now()
);

-- One row per order sent. flag_id is unique, so an order can never be sent twice, even on a double click.
create table if not exists zoho_sync (
  id         bigint generated always as identity primary key,
  flag_id    bigint not null unique references flags(id) on delete cascade,
  status     text not null check (status in ('sending', 'sent', 'failed')),
  po_id      text,
  po_number  text,
  quantity   integer,
  error      text,
  batch_ref  text,
  sent_at    timestamptz not null default now()
);
