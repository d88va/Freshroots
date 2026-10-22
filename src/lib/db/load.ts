// Writes parsed CSV rows into Neon. Used by the seed loader script and the Upload page,
// so a real SAP or Zoho export goes through exactly the same path as the synthetic files.

import { bulkWrite, type Sql } from "./client";
import { parseByKind, type FileKind } from "../csv/adapter";

export interface LoadSummary {
  kind: FileKind;
  rowsRead: number;
  rowsSaved: number;
  rejected: { line: number; message: string }[]; // bad rows from the adapter, plus unknown SKUs
  warnings: string[];
}

async function knownSkuIds(sql: Sql): Promise<Set<string>> {
  const rows = (await sql.query("select sku_id from skus")) as { sku_id: string }[];
  return new Set(rows.map((r) => r.sku_id));
}

export async function loadCsv(sql: Sql, kind: FileKind, text: string, filename?: string): Promise<LoadSummary> {
  const parsed = parseByKind(kind, text);
  const rejected = [...parsed.errors];
  let rows = parsed.rows as unknown as Record<string, unknown>[];

  if (kind !== "skus" && kind !== "calendar_events") {
    // Everything else points at a SKU, so SKUs must be loaded first.
    const known = await knownSkuIds(sql);
    const unknown = new Set<string>();
    rows = rows.filter((r) => (known.has(r.sku_id as string) ? true : (unknown.add(r.sku_id as string), false)));
    if (unknown.size) {
      rejected.push({ line: 0, message: `${unknown.size} SKU id(s) not in the SKU master were skipped, e.g. ${[...unknown].slice(0, 5).join(", ")}. Upload the SKU master first.` });
    }
  }

  switch (kind) {
    case "calendar_events": await bulkWrite(sql, "calendar_events", ["kind", "name", "start_date", "end_date", "note", "logged_by"], rows, ["kind", "name", "start_date"]); break;
    case "skus": await bulkWrite(sql, "skus", ["sku_id", "name", "category", "is_perishable", "standard_order_qty", "launch_date"], rows, ["sku_id"]); break;
    case "sales": await bulkWrite(sql, "weekly_sales", ["sku_id", "week_start", "units"], rows, ["sku_id", "week_start"]); break;
    case "stock": await bulkWrite(sql, "stock_snapshots", ["sku_id", "snapshot_date", "units_on_hand"], rows, ["sku_id", "snapshot_date"]); break;
    case "loss_events": await bulkWrite(sql, "loss_events", ["sku_id", "week_start", "type", "value_inr"], rows, ["sku_id", "week_start", "type"]); break;
    case "open_pos":
      // A new Zoho export replaces the old list: open POs are a snapshot, not history.
      await sql.query("delete from open_pos");
      await bulkWrite(sql, "open_pos", ["sku_id", "qty", "expected_date"], rows);
      break;
  }
  await sql.query("insert into import_log (kind, filename, rows_read, rows_saved, rows_rejected) values ($1,$2,$3,$4,$5)", [kind, filename ?? null, parsed.rowsRead, rows.length, rejected.length]);
  return { kind, rowsRead: parsed.rowsRead, rowsSaved: rows.length, rejected, warnings: parsed.warnings };
}
