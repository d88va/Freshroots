// The ONLY information Gemini is given about a flag. Every figure here was computed by the rules engine.
// The number check later allows the AI to use these figures and nothing else.

import type { Evaluation } from "../rules/engine";

export interface ReasonContext {
  evaluation: Evaluation;
  sku_name: string;
  is_perishable: boolean;
}

export type Facts = Record<string, string | number | boolean | string[]>;

const TRIGGER_WORDS: Record<string, string> = {
  short_history: "too little sales history (a new launch)",
  missing_weeks: "weeks of sales data are missing",
  no_sales: "no sales in the last 12 weeks",
  demand_surge: "recent sales are far above the 12-week average",
  demand_drop: "recent sales are far below the 12-week average",
};

export function buildFacts({ evaluation: e, sku_name, is_perishable }: ReasonContext): Facts {
  const n = e.numbers;
  const f: Facts = {
    sku_name,
    flag: e.flag_type,
    also_flags: e.also_types,
    urgent: e.urgent,
    window_recent_weeks: n.recent_weeks,
    window_baseline_weeks: n.baseline_weeks,
  };
  if (n.season_factor !== 1) f.festival_uplift_percent = Math.round((n.season_factor - 1) * 100);
  const types = [e.flag_type, ...e.also_types];

  if (e.flag_type === "needs_judgment") {
    f.why_it_needs_judgment = n.triggers.map((t) => TRIGGER_WORDS[t]);
    f.weeks_of_sales_history = n.history_weeks;
    if (n.missing_weeks) f.weeks_missing_in_last_12 = n.missing_weeks;
    f.avg_weekly_sales_last_4_weeks = n.avg_recent;
    f.avg_weekly_sales_last_12_weeks = n.avg_baseline;
    f.rules_would_otherwise_say = n.context_flags;
    return f;
  }
  f.stock_units = n.stock;
  if (types.includes("stockout_risk") || types.includes("overstock_risk")) {
    f.weeks_of_stock = n.weeks_of_stock ?? 0;
    f.weekly_demand_used_for_stock_check = n.stock_baseline;
    if (types.includes("stockout_risk")) f.minimum_weeks_of_stock = n.min_weeks;
    if (types.includes("overstock_risk")) f.maximum_weeks_of_stock = n.max_weeks;
    f.is_perishable = is_perishable;
  }
  if (types.includes("high_demand")) {
    f.avg_weekly_sales_last_4_weeks = n.avg_recent;
    f.avg_weekly_sales_last_12_weeks = n.demand_baseline;
    f.sales_above_12_week_average_percent = Math.round(((n.avg_recent / n.demand_baseline) - 1) * 100);
  }
  if (e.recommended_qty !== null) {
    f.standard_order_units = n.standard_order_qty;
    f.recommended_order_units = e.recommended_qty;
  }
  f.recommended_action = e.recommended_qty === null ? "pause the next order" : "reorder now";
  if (n.conflict) f.note = "demand is rising but stock is very high: the rules point in opposite directions, so Raghav must decide";
  return f;
}

/** Every number the AI may use: the numbers in the facts, plus any digits inside the SKU name (like 200g). */
export function allowedNumbers(facts: Facts): number[] {
  const out: number[] = [];
  for (const [key, v] of Object.entries(facts)) {
    if (typeof v === "number") out.push(v);
    if (key === "sku_name" && typeof v === "string") out.push(...extractNumbers(v));
  }
  return out;
}

/** Pulls every number out of a piece of text. "1,441" is 1441, "1.5x" is 1.5, "25%" is 25. */
export function extractNumbers(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((t) => Number(t.replace(/,/g, "")));
}

const LABELS: Record<string, string> = {
  sku_name: "Product",
  flag: "Decision made by the rules",
  also_flags: "Also true",
  urgent: "Urgent",
  window_recent_weeks: "Recent period (weeks)",
  window_baseline_weeks: "Longer baseline period (weeks)",
  festival_uplift_percent: "Festival uplift applied to demand (percent)",
  why_it_needs_judgment: "Why the rules cannot decide",
  weeks_of_sales_history: "Weeks of sales history",
  weeks_missing_in_last_12: "Weeks of sales missing in the last 12",
  avg_weekly_sales_last_4_weeks: "Average weekly sales, recent period (units)",
  avg_weekly_sales_last_12_weeks: "Average weekly sales, baseline period (units)",
  rules_would_otherwise_say: "Rules would otherwise have said",
  stock_units: "Stock on hand (units)",
  weeks_of_stock: "Weeks of stock",
  weekly_demand_used_for_stock_check: "Weekly demand used for the stock check (units)",
  minimum_weeks_of_stock: "Minimum weeks of stock allowed",
  maximum_weeks_of_stock: "Maximum weeks of stock allowed",
  is_perishable: "Perishable",
  sales_above_12_week_average_percent: "Recent sales above the baseline average (percent)",
  standard_order_units: "Standard order (units)",
  recommended_order_units: "Recommended order (units)",
  recommended_action: "Recommended action",
  note: "Note",
};
const WORDS: Record<string, string> = { stockout_risk: "stockout risk", overstock_risk: "overstock risk", high_demand: "high demand", needs_judgment: "needs judgment" };
const plain = (v: Facts[string]) => (Array.isArray(v) ? v.map((x) => WORDS[x] ?? x).join("; ") || "none" : typeof v === "string" ? WORDS[v] ?? v : String(v));

/** The facts as plain-English lines, so the model has no code-style field names to copy. */
export function factsToPrompt(facts: Facts): string {
  return Object.entries(facts).map(([k, v]) => `- ${LABELS[k] ?? k}: ${plain(v)}`).join("\n");
}
