import type { Sql } from "../db/client";
import type { PoLine } from "./format";

export interface PoDay { date: string; lines: number; units: number; first: string; last: string }

/** One purchase order per day on which Raghav approved or edited orders, newest first. */
export async function listPoDays(sql: Sql): Promise<PoDay[]> {
  return (await sql.query(
    `select to_char(decided_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as date, count(*)::int as lines, sum(final_qty)::int as units,
            min(decided_at)::text as first, max(decided_at)::text as last
       from flags where status in ('approved', 'edited') and final_qty > 0 group by 1 order by 1 desc`)) as PoDay[];
}

/** The lines of the purchase order for one day (a date in India). */
export async function getPoLines(sql: Sql, date: string): Promise<PoLine[]> {
  return (await sql.query(
    `select f.sku_id, s.name, s.category, s.is_perishable, f.final_qty as quantity, f.recommended_qty, f.status, f.flag_type, f.urgent, f.decision_tag,
            (f.numbers->>'weeks_of_stock')::float8 as weeks_of_stock
       from flags f join skus s using (sku_id)
      where f.status in ('approved', 'edited') and f.final_qty > 0 and to_char(f.decided_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') = $1
      order by s.category, s.name`, [date])) as PoLine[];
}
