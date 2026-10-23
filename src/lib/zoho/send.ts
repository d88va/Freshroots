// Sends approved orders to Zoho as DRAFT purchase orders. Only orders Raghav approved or edited are ever eligible:
// the query below is the whole list, and there is no other way in. Nothing is issued: procurement places each draft in Zoho.

import type { Sql } from "../db/client";
import { buildDraftPurchaseOrder, ZohoError, type ZohoClient, type ZohoConfig, type PurchaseOrderLine } from "./client";

export const SEND_CAP = 50; // lines in one draft purchase order
const RECENT_DAYS = 14; // older orders are history, not something to send now

export interface SendSummary {
  sent: number; units: number; po_number: string | null; po_id: string | null;
  failed: { sku_id: string; name: string; error: string }[];
}

/** How many approved orders are waiting to be sent. */
export async function unsentCount(sql: Sql): Promise<number> {
  const [r] = (await sql.query(
    `select count(*)::int as n from flags f
      where f.status in ('approved','edited') and f.final_qty > 0 and f.decided_at > now() - interval '${RECENT_DAYS} days'
        and not exists (select 1 from zoho_sync z where z.flag_id = f.id and (z.status = 'sent' or (z.status = 'sending' and z.sent_at > now() - interval '10 minutes')))`)) as { n: number }[];
  return r.n;
}

/** `only` limits the send to those orders (used by tests, so they can never touch real orders). Normal use sends everything eligible. */
export async function sendOrdersToZoho(sql: Sql, client: ZohoClient, cfg: ZohoConfig, now: Date = new Date(), only?: number[]): Promise<SendSummary> {
  const batch = `FR-${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  const summary: SendSummary = { sent: 0, units: 0, po_number: null, po_id: null, failed: [] };

  // 1. Claim the orders. A row is claimed by inserting it; one already sent, or being sent a moment ago, is never claimed again.
  const won = (await sql.query(
    `insert into zoho_sync (flag_id, status, quantity, batch_ref)
     select f.id, 'sending', f.final_qty, $1 from flags f
      where f.status in ('approved','edited') and f.final_qty > 0 and f.decided_at > now() - interval '${RECENT_DAYS} days'
        and ($2::bigint[] is null or f.id = any($2::bigint[]))
        and not exists (select 1 from zoho_sync z where z.flag_id = f.id and (z.status = 'sent' or (z.status = 'sending' and z.sent_at > now() - interval '10 minutes')))
      order by f.decided_at limit ${SEND_CAP}
     on conflict (flag_id) do update set status = 'sending', quantity = excluded.quantity, batch_ref = excluded.batch_ref, error = null, sent_at = now()
       where zoho_sync.status = 'failed' or (zoho_sync.status = 'sending' and zoho_sync.sent_at < now() - interval '10 minutes')
     returning flag_id`, [batch, only ?? null])) as { flag_id: number }[];
  // Only the rows THIS call won: a concurrent send that lost the race gets nothing, so an order can never go out twice.
  const claimed = won.length ? (await sql.query(
    `select z.flag_id, f.sku_id, s.name, z.quantity from zoho_sync z join flags f on f.id = z.flag_id join skus s using (sku_id)
      where z.flag_id = any($1::bigint[]) and z.status = 'sending' order by f.decided_at`, [won.map((w) => Number(w.flag_id))])) as { flag_id: number; sku_id: string; name: string; quantity: number }[] : [];
  if (!claimed.length) return summary;

  const fail = async (flagId: number, error: string, row: { sku_id: string; name: string }) => {
    await sql.query("update zoho_sync set status = 'failed', error = $2, sent_at = now() where flag_id = $1", [flagId, error.slice(0, 500)]);
    summary.failed.push({ sku_id: row.sku_id, name: row.name, error });
  };

  // 2. Find each SKU's item in Zoho (remembered after the first time).
  const cached = new Map(((await sql.query("select sku_id, zoho_item_id from zoho_items where sku_id = any($1::text[])", [claimed.map((c) => c.sku_id)])) as { sku_id: string; zoho_item_id: string }[]).map((r) => [r.sku_id, r.zoho_item_id]));
  const lines: (PurchaseOrderLine & { flag_id: number })[] = [];
  const rowsByFlag = new Map<number, (typeof claimed)[number]>();
  for (const c of claimed) {
    rowsByFlag.set(Number(c.flag_id), c);
    try {
      let itemId = cached.get(c.sku_id) ?? null;
      if (!itemId) {
        itemId = await client.getItemBySku(c.sku_id);
        if (!itemId && cfg.autoCreateItems) itemId = await client.createItem({ name: c.name, sku: c.sku_id });
        if (itemId) await sql.query("insert into zoho_items (sku_id, zoho_item_id) values ($1,$2) on conflict (sku_id) do update set zoho_item_id = excluded.zoho_item_id, cached_at = now()", [c.sku_id, itemId]);
      }
      if (!itemId) { await fail(Number(c.flag_id), `No item with SKU ${c.sku_id} exists in Zoho.`, c); continue; }
      lines.push({ flag_id: Number(c.flag_id), item_id: itemId, quantity: c.quantity });
    } catch (e) {
      await fail(Number(c.flag_id), (e as Error).message, c);
    }
  }
  if (!lines.length) return summary;

  // 3. One DRAFT purchase order with every line. It is not issued.
  try {
    const po = await client.createDraftPurchaseOrder(buildDraftPurchaseOrder({
      vendorId: cfg.vendorId, date: new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10), reference: batch,
      notes: `DRAFT created by Freshroots Demand Planning from orders Raghav approved. Review and place it in Zoho. Nothing was issued automatically.`,
      lines: lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
    }));
    for (const l of lines) {
      await sql.query("update zoho_sync set status = 'sent', po_id = $2, po_number = $3, error = null, sent_at = now() where flag_id = $1", [l.flag_id, po.id, po.number]);
      summary.sent++; summary.units += l.quantity;
    }
    summary.po_id = po.id; summary.po_number = po.number;
  } catch (e) {
    const msg = e instanceof ZohoError ? e.message : `Could not reach Zoho: ${(e as Error).message}`;
    for (const l of lines) await fail(l.flag_id, msg, rowsByFlag.get(l.flag_id)!);
  }
  return summary;
}
