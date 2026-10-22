// Decides what a run does with the flags the rules produced. Pure: no database.
//   - a SKU with no pending flag gets a new one
//   - a SKU that already has a pending flag keeps it, updated in place only if its numbers changed
//   - a SKU decided within the cooldown is held back (not flagged again so soon)
// "Running twice never duplicates a pending flag" is also guaranteed by the database (migration 007).

import type { Evaluation } from "../rules/engine";

export interface PendingFlag {
  id: number;
  sku_id: string;
  flag_type: Evaluation["flag_type"];
  also_types: string[];
  urgent: boolean;
  recommended_qty: number | null;
  numbers: Record<string, unknown>;
}

export interface RunPlan {
  insert: Evaluation[];
  refresh: { flagId: number; evaluation: Evaluation }[];
  unchanged: number;
  held: number;
  noLongerFlagged: string[]; // pending flags whose SKU the rules no longer flag. They are left for Raghav to decide.
}

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
};
const withoutDate = (n: Record<string, unknown>) => { const { run_date, ...rest } = n; void run_date; return rest; };

export function sameFlag(e: Evaluation, p: PendingFlag): boolean {
  return e.flag_type === p.flag_type && e.urgent === p.urgent && e.recommended_qty === p.recommended_qty
    && stable([...e.also_types].sort()) === stable([...p.also_types].sort())
    && stable(withoutDate(e.numbers as unknown as Record<string, unknown>)) === stable(withoutDate(p.numbers));
}

export function planRun(evals: Evaluation[], pending: PendingFlag[], recentlyDecided: ReadonlySet<string>): RunPlan {
  const pendingBySku = new Map(pending.map((p) => [p.sku_id, p]));
  const plan: RunPlan = { insert: [], refresh: [], unchanged: 0, held: 0, noLongerFlagged: [] };
  const flagged = new Set<string>();
  for (const e of evals) {
    flagged.add(e.sku_id);
    const p = pendingBySku.get(e.sku_id);
    if (p) {
      if (sameFlag(e, p)) plan.unchanged++;
      else plan.refresh.push({ flagId: p.id, evaluation: e });
    } else if (recentlyDecided.has(e.sku_id)) plan.held++;
    else plan.insert.push(e);
  }
  plan.noLongerFlagged = pending.filter((p) => !flagged.has(p.sku_id)).map((p) => p.sku_id);
  return plan;
}
