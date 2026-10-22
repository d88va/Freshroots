import type { Sql } from "../db/client";

export interface ReviewFlag {
  id: number; sku_id: string; name: string; category: string; is_perishable: boolean;
  flag_type: "high_demand" | "stockout_risk" | "overstock_risk" | "needs_judgment";
  also_types: string[]; urgent: boolean; recommended_qty: number | null;
  numbers: {
    stock: number; standard_order_qty: number; avg_recent: number; avg_baseline: number; demand_baseline: number; season_factor: number;
    weeks_of_stock: number | null; recent_vs_baseline: number | null; window_type: "perishable" | "standard"; min_weeks: number; max_weeks: number;
    recent_weeks: number; baseline_weeks: number; history_weeks: number; missing_weeks: number; triggers: string[]; context_flags: string[]; conflict: boolean; run_date: string;
  };
  reason: string | null; reason_source: "ai" | "template" | null; reason_fallback: string | null; reason_rating: "up" | "down" | null;
  status: string; final_qty: number | null; decision_tag: string | null; override_reason: string | null; decided_at: string | null; created_at: string; run_id: number;
}

// Neon returns bigint columns as text, so ids are turned into numbers here, once.
const fix = (rows: unknown[]) => (rows as ReviewFlag[]).map((r) => ({ ...r, id: Number(r.id), run_id: Number(r.run_id) }));

const COLUMNS = `f.id, f.run_id, f.sku_id, s.name, s.category, s.is_perishable, f.flag_type, f.also_types, f.urgent, f.recommended_qty, f.numbers,
  f.reason, f.reason_source, f.reason_fallback, f.reason_rating, f.status, f.final_qty, f.decision_tag, f.override_reason, f.decided_at, f.created_at`;

export async function pendingFlags(sql: Sql): Promise<ReviewFlag[]> {
  return fix(await sql.query(
    `select ${COLUMNS} from flags f join skus s using (sku_id) where f.status = 'pending'
     order by f.urgent desc,
              case f.flag_type when 'stockout_risk' then 0 when 'high_demand' then 1 when 'overstock_risk' then 2 else 3 end,
              coalesce((f.numbers->>'weeks_of_stock')::numeric, 999), f.sku_id`));
}

export async function ordersList(sql: Sql): Promise<ReviewFlag[]> {
  return fix(await sql.query(`select ${COLUMNS} from flags f join skus s using (sku_id) where f.status in ('approved','edited') and f.final_qty > 0 order by f.decided_at desc, f.sku_id`));
}

export async function pausesList(sql: Sql): Promise<ReviewFlag[]> {
  return fix(await sql.query(`select ${COLUMNS} from flags f join skus s using (sku_id) where f.status = 'approved' and f.final_qty is null order by f.decided_at desc, f.sku_id`));
}

export async function decidedFlags(sql: Sql, status?: string): Promise<ReviewFlag[]> {
  return fix(await sql.query(`select ${COLUMNS} from flags f join skus s using (sku_id) where f.status <> 'pending' ${status ? "and f.status = $1" : ""} order by f.decided_at desc`, status ? [status] : []));
}
