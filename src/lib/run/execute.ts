// One run: read the data, apply the rules to every SKU, save the flags, then add reasons.
// The rules engine decides every flag and number. Reasons are added afterwards and cannot change them.

import type { Sql } from "../db/client";
import { loadHistory } from "../db/history";
import { evaluateAll, parseSettings, type SkuInput } from "../rules/engine";
import { fillReasons, type FillSummary } from "../reasons/apply";
import type { TextGenerator } from "../reasons/gemini";
import { templateReason } from "../reasons/template";

export interface RunSummary {
  run_id: number;
  run_date: string;
  flagged: number;
  new_flags: number;
  already_pending: number; // SKUs that kept the pending flag from an earlier run
  reasons: FillSummary;
}

export async function executeRun(sql: Sql, o: { trigger: "cron" | "manual" | "upload"; runDate: string; gen: TextGenerator | null; reasonBudgetMs: number }): Promise<RunSummary> {
  const [run] = (await sql.query("insert into runs (trigger) values ($1) returning id", [o.trigger])) as { id: number }[];
  try {
    const settings = parseSettings((await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[]);
    const h = await loadHistory(sql);
    const latest = (await sql.query(
      "select distinct on (sku_id) sku_id, units_on_hand from stock_snapshots where snapshot_date <= $1 order by sku_id, snapshot_date desc", [o.runDate])) as { sku_id: string; units_on_hand: number }[];
    const stock = new Map(latest.map((r) => [r.sku_id, r.units_on_hand]));
    const inputs: SkuInput[] = h.skus.map((s) => ({ sku_id: s.sku_id, is_perishable: s.is_perishable, standard_order_qty: s.standard_order_qty, stock: stock.get(s.sku_id) ?? 0, sales: h.sales.get(s.sku_id) ?? new Map() }));
    const evals = evaluateAll(inputs, o.runDate, settings);

    let created = 0;
    for (const e of evals) {
      const res = (await sql.query(
        `insert into flags (run_id, sku_id, flag_type, also_types, urgent, recommended_qty, numbers, reason, reason_source, reason_fallback)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'template',$9)
         on conflict (sku_id) where status = 'pending' do nothing returning id`,
        [run.id, e.sku_id, e.flag_type, e.also_types, e.urgent, e.recommended_qty, JSON.stringify(e.numbers), templateReason(e), o.gen ? "not_yet" : "no_key"])) as { id: number }[];
      created += res.length;
    }
    const reasons = await fillReasons(sql, { gen: o.gen, budgetMs: o.reasonBudgetMs });
    await sql.query("update runs set status = 'succeeded', finished_at = now(), flags_raised = $2 where id = $1", [run.id, created]);
    return { run_id: run.id, run_date: o.runDate, flagged: evals.length, new_flags: created, already_pending: evals.length - created, reasons };
  } catch (e) {
    await sql.query("update runs set status = 'failed', finished_at = now(), error = $2 where id = $1", [run.id, (e as Error).message]);
    throw e;
  }
}
