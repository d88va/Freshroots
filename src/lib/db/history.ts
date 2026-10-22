// Loads the full history from Neon for the backtest.
import type { Sql } from "./client";
import type { BtLoss, BtSku } from "../backtest/replay";

export async function loadHistory(sql: Sql) {
  const skus = (await sql.query("select sku_id, is_perishable, standard_order_qty, category from skus order by sku_id")) as BtSku[];
  const salesRows = (await sql.query("select sku_id, to_char(week_start, 'YYYY-MM-DD') as d, units from weekly_sales")) as { sku_id: string; d: string; units: number }[];
  const stockRows = (await sql.query("select sku_id, to_char(snapshot_date, 'YYYY-MM-DD') as d, units_on_hand as units from stock_snapshots")) as { sku_id: string; d: string; units: number }[];
  const lossRows = (await sql.query("select sku_id, to_char(week_start, 'YYYY-MM-DD') as week_start, type, value_inr::float8 as value_inr from loss_events order by week_start")) as BtLoss[];
  const nest = (rows: { sku_id: string; d: string; units: number }[]) => {
    const m = new Map<string, Map<string, number>>();
    for (const r of rows) {
      let inner = m.get(r.sku_id);
      if (!inner) m.set(r.sku_id, (inner = new Map()));
      inner.set(r.d, r.units);
    }
    return m;
  };
  return { skus, sales: nest(salesRows), stock: nest(stockRows), losses: lossRows };
}

/** What one run needs: SKUs, all sales history, and the latest stock count on or before the run date. */
export async function loadForRun(sql: Sql, runDate: string) {
  const skus = (await sql.query("select sku_id, is_perishable, standard_order_qty, category from skus order by sku_id")) as BtSku[];
  const salesRows = (await sql.query("select sku_id, to_char(week_start, 'YYYY-MM-DD') as d, units from weekly_sales")) as { sku_id: string; d: string; units: number }[];
  const latest = (await sql.query(
    "select distinct on (sku_id) sku_id, units_on_hand from stock_snapshots where snapshot_date <= $1 order by sku_id, snapshot_date desc", [runDate])) as { sku_id: string; units_on_hand: number }[];
  const sales = new Map<string, Map<string, number>>();
  for (const r of salesRows) {
    let inner = sales.get(r.sku_id);
    if (!inner) sales.set(r.sku_id, (inner = new Map()));
    inner.set(r.d, r.units);
  }
  return { skus, sales, stock: new Map(latest.map((r) => [r.sku_id, r.units_on_hand])) };
}
