// Template reasons, written by code. Used whenever the AI is down, slow, rate limited or rejected.
// They contain only figures the rules engine computed, so they can never be wrong about a number.

import type { Evaluation } from "../rules/engine";

const num = (x: number) => (Number.isInteger(x) ? x.toLocaleString("en-IN") : String(x));

export function templateReason(e: Evaluation): string {
  const n = e.numbers;
  const festival = n.season_factor !== 1 ? ` (after the ${Math.round((n.season_factor - 1) * 100)}% festival uplift)` : "";
  const cover = `Stock of ${num(n.stock)} units covers ${n.weeks_of_stock} weeks of sales${festival}`;
  const types = [e.flag_type, ...e.also_types];

  if (e.flag_type === "needs_judgment") {
    const parts: string[] = [];
    if (n.triggers.includes("short_history")) parts.push(`only ${n.history_weeks} weeks of sales history`);
    if (n.triggers.includes("missing_weeks")) parts.push(`${n.missing_weeks} week${n.missing_weeks === 1 ? "" : "s"} of sales missing in the last ${n.baseline_weeks}`);
    if (n.triggers.includes("no_sales")) parts.push(`no sales in the last ${n.baseline_weeks} weeks`);
    if (n.triggers.includes("demand_surge") || n.triggers.includes("demand_drop")) {
      parts.push(`sales over the last ${n.recent_weeks} weeks are ${n.recent_vs_baseline}x the ${n.baseline_weeks}-week average, outside the normal range`);
    }
    return `Needs your judgment: ${parts.join(" and ")}, so the rules cannot recommend a quantity.`;
  }
  if (n.conflict) {
    return `${cover}, above the ${n.max_weeks}-week maximum, but sales over the last ${n.recent_weeks} weeks are rising, so the rules point in opposite directions: please decide.`;
  }
  if (e.flag_type === "high_demand") {
    const demand = `Sales over the last ${n.recent_weeks} weeks averaged ${num(n.avg_recent)} a week against ${num(n.demand_baseline)} over ${n.baseline_weeks} weeks`;
    const order = `order ${num(e.recommended_qty!)} units.`;
    return types.includes("stockout_risk")
      ? `Urgent: ${demand}, and ${cover.charAt(0).toLowerCase() + cover.slice(1)}, below the ${n.min_weeks}-week minimum; ${order}`
      : `${demand}; ${order}`;
  }
  if (e.flag_type === "stockout_risk") return `${cover}, below the ${n.min_weeks}-week minimum; reorder ${num(e.recommended_qty!)} units now.`;
  return `${cover}, above the ${n.max_weeks}-week maximum; pause the next order.`;
}
