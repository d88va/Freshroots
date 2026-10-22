// The outcome check. For every decided flag that is at least 28 days old and has no outcome yet:
//   approved or edited -> record where the stock ended up (back in its healthy band, or still outside it).
//                         It NEVER says the flag was right or wrong: the order itself changed what happened.
//   overridden         -> record whether the feared stockout or write-off happened anyway in the next 4 weeks.
//                         If not, Raghav was right. If it did, he was wrong.
// It also records misses: losses on a SKU that had no flag in the 4 weeks before.
// It only writes facts into the outcomes table. It changes no rule and no flag.

import type { Sql } from "../db/client";
import { loadHistory } from "../db/history";
import { addDays, mondayOf } from "../rules/dates";
import { measureSku, parseSettings } from "../rules/engine";

export interface OutcomeSummary { end_states: number; override_checks: number; right: number; wrong: number; misses: number; note: string | null }

interface DecidedRow { id: number; sku_id: string; flag_type: string; status: string; numbers: { window_type: string }; decided_on: string }

export async function runOutcomeCheck(sql: Sql, now: Date = new Date()): Promise<OutcomeSummary> {
  const settingRows = (await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[];
  const settings = parseSettings(settingRows);
  const get = (k: string) => settingRows.find((r) => r.key === k)?.value;
  const waitDays = Number(get("outcome_check_days") ?? 28);
  const goLive = typeof get("go_live_date") === "string" ? (get("go_live_date") as string) : null;
  const sum: OutcomeSummary = { end_states: 0, override_checks: 0, right: 0, wrong: 0, misses: 0, note: null };

  const due = ((await sql.query(
    `select f.id, f.sku_id, f.flag_type, f.status, f.numbers, to_char(f.decided_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as decided_on
       from flags f
      where f.status <> 'pending' and f.decided_at <= $1::timestamptz - make_interval(days => $2)
        and not exists (select 1 from outcomes o where o.flag_id = f.id)
      order by f.decided_at`, [now.toISOString(), waitDays])) as DecidedRow[]).map((r) => ({ ...r, id: Number(r.id) }));

  const rows: [number | null, string, string, string][] = []; // flag_id, kind, result, detail: saved in batches below
  if (due.length) {
    const needsHistory = due.some((d) => d.status !== "overridden");
    const h = needsHistory ? await loadHistory(sql) : null;
    const skuInfo = new Map((h?.skus ?? []).map((s) => [s.sku_id, s]));
    const lossRows = (await sql.query("select sku_id, type, to_char(week_start,'YYYY-MM-DD') as week_start, value_inr::float8 as value_inr from loss_events where week_start >= $1::date", [addDays(due[0].decided_on, -7)])) as { sku_id: string; type: string; week_start: string; value_inr: number }[];

    for (const d of due) {
      if (d.status === "overridden") {
        // The feared event: a write-off for an overstock flag, a stockout for everything else.
        const feared = d.flag_type === "overstock_risk" ? "write_off" : "stockout";
        const from = mondayOf(d.decided_on), to = addDays(d.decided_on, 28);
        const events = lossRows.filter((e) => e.sku_id === d.sku_id && e.type === feared && e.week_start >= from && e.week_start <= to);
        const result = events.length ? "raghav_wrong" : "raghav_right";
        rows.push([d.id, "override_check", result, JSON.stringify({ feared, window_from: from, window_to: to, events: events.map((e) => ({ week: e.week_start, value_inr: e.value_inr })) })]);
        sum.override_checks++; events.length ? sum.wrong++ : sum.right++;
      } else {
        // Where did the stock end up, 4 weeks after the decision, against this SKU's own healthy band?
        const checkDate = addDays(d.decided_on, waitDays);
        const sku = skuInfo.get(d.sku_id);
        const stockMap = h!.stock.get(d.sku_id);
        const stock = stockMap?.get(mondayOf(checkDate));
        let result = "unknown", detail: Record<string, unknown> = { checked_on: checkDate };
        if (sku && stock !== undefined) {
          const m = measureSku({ sku_id: d.sku_id, is_perishable: sku.is_perishable, standard_order_qty: sku.standard_order_qty, stock, sales: h!.sales.get(d.sku_id) ?? new Map() }, checkDate, settings).numbers;
          if (m.weeks_of_stock !== null) {
            result = m.weeks_of_stock < m.min_weeks ? "still_low" : m.weeks_of_stock > m.max_weeks ? "still_high" : "healthy";
            detail = { checked_on: checkDate, weeks_of_stock: m.weeks_of_stock, healthy_band: [m.min_weeks, m.max_weeks], stock };
          }
        }
        rows.push([d.id, "approved_end_state", result, JSON.stringify(detail)]);
        sum.end_states++;
      }
    }
  }

  // Misses: a loss on a SKU with no flag in the 4 weeks before it. Only counted once the system has been live long enough to have a full 4 weeks.
  if (goLive) {
    const missed = (await sql.query(
      `select e.id, e.sku_id, e.type, to_char(e.week_start,'YYYY-MM-DD') as week_start, e.value_inr::float8 as value_inr
         from loss_events e
        where e.week_start >= $1::date + 28 and e.week_start <= $2::date - 7
          and not exists (select 1 from flags f where f.sku_id = e.sku_id and f.created_at >= e.week_start - interval '28 days' and f.created_at < e.week_start)
          and not exists (select 1 from outcomes o where o.kind = 'miss' and o.detail->>'loss_event_id' = e.id::text)`, [goLive, now.toISOString().slice(0, 10)])) as { id: number; sku_id: string; type: string; week_start: string; value_inr: number }[];
    for (const m of missed) {
      rows.push([null, "miss", "no_flag_in_prior_4_weeks", JSON.stringify({ loss_event_id: String(m.id), sku_id: m.sku_id, type: m.type, week_start: m.week_start, value_inr: m.value_inr })]);
      sum.misses++;
    }
  } else sum.note = "No go-live date is set, so misses are not counted.";

  // Save in batches of 200 rows. A row that already exists (same flag, or same missed loss) is skipped by the database.
  for (let i = 0; i < rows.length; i += 200) {
    const params: unknown[] = [];
    const tuples = rows.slice(i, i + 200).map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`);
    await sql.query(`insert into outcomes (flag_id, kind, result, detail) values ${tuples.join(",")} on conflict do nothing`, params);
  }
  return sum;
}
