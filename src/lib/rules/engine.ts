// THE CUT: every number and every flag is computed here, in plain code.
// These are pure functions. No database, no AI, no clock: the same inputs always give the same flag.
//
// Order of evaluation, as agreed:
//   1. season factor
//   2. needs_judgment check (if it fires, nothing else is flagged and no quantity is recommended)
//   3. stock windows: perishable windows REPLACE the standard 6 and 14 week windows
//   4. high_demand
// A SKU that is both high_demand and stockout_risk is one flag, marked urgent.

import { addDays, mondayOf, monthOf } from "./dates";

export type FlagType = "high_demand" | "stockout_risk" | "overstock_risk" | "needs_judgment";
export type SeasonMode = "baseline" | "weeks_check_only";
export type JudgmentTrigger = "short_history" | "missing_weeks" | "no_sales" | "demand_surge" | "demand_drop";

export interface RuleSettings {
  high_demand_pct: number;
  high_demand_multiplier: number;
  recent_weeks: number;
  baseline_weeks: number;
  stockout_weeks: number;
  overstock_weeks: number;
  perishable_min_weeks: number;
  perishable_max_weeks: number;
  season_months: number[];
  season_uplift: number;
  season_mode: SeasonMode;
  judgment_min_history_weeks: number;
  judgment_max_missing_weeks: number;
  judgment_ratio_high: number;
  judgment_ratio_low: number;
}

/** Same values as the defaults in neon/migrations/002_rules.sql. At run time the database copy is used. */
export const DEFAULT_SETTINGS: RuleSettings = {
  high_demand_pct: 20,
  high_demand_multiplier: 1.5,
  recent_weeks: 4,
  baseline_weeks: 12,
  stockout_weeks: 6,
  overstock_weeks: 14,
  perishable_min_weeks: 3,
  perishable_max_weeks: 4,
  season_months: [10, 11, 3],
  season_uplift: 1.25,
  season_mode: "baseline",
  judgment_min_history_weeks: 12,
  judgment_max_missing_weeks: 0,
  judgment_ratio_high: 2,
  judgment_ratio_low: 0.5,
};

/** Turns rows from the rule_settings table into typed settings. Throws if a setting is missing. */
export function parseSettings(rows: { key: string; value: unknown }[]): RuleSettings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!byKey.has(key)) throw new Error(`Setting "${key}" is missing from rule_settings.`);
    out[key] = byKey.get(key);
  }
  return out as unknown as RuleSettings;
}

export interface SkuInput {
  sku_id: string;
  is_perishable: boolean;
  standard_order_qty: number;
  stock: number; // units on hand at the run date
  sales: ReadonlyMap<string, number>; // week_start (Monday) -> units. A week that is absent is a gap.
}

/** Every figure behind a flag. The AI is only ever shown these numbers. */
export interface FlagNumbers {
  run_date: string;
  stock: number;
  standard_order_qty: number;
  avg_recent: number; // average weekly sales, last 4 weeks
  avg_baseline: number; // average weekly sales, last 12 weeks (before any season uplift)
  season_factor: number; // 1 outside festival months
  season_mode: SeasonMode;
  demand_baseline: number; // 12-week average after the season factor, as used for the demand checks
  stock_baseline: number; // 12-week average after the season factor, as used for weeks of stock
  weeks_of_stock: number | null;
  recent_vs_baseline: number | null; // ratio of the 4-week average to demand_baseline
  window_type: "perishable" | "standard";
  min_weeks: number;
  max_weeks: number;
  recent_weeks: number; // window sizes, so reasons can say "last 4 weeks" without guessing
  baseline_weeks: number;
  history_weeks: number;
  missing_weeks: number;
  triggers: JudgmentTrigger[]; // why it needs judgment (empty for other flags)
  // For needs_judgment only: what the rules WOULD have flagged. Shown as context, never recommended.
  context_flags: FlagType[];
  conflict: boolean; // true when high_demand and overstock_risk both fire (they point opposite ways)
}

export interface Evaluation {
  sku_id: string;
  flag_type: FlagType;
  also_types: FlagType[];
  urgent: boolean;
  recommended_qty: number | null; // null = pause the next order (overstock) or no recommendation (needs judgment)
  numbers: FlagNumbers;
}

const EPS = 1e-9; // "more than" and "below" are strict; this stops 1.2 * 100 = 120.00000000000001 flagging
const r2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface Measure { numbers: FlagNumbers; types: FlagType[]; triggers: JudgmentTrigger[] }

/** Every figure for one SKU on one run date, whether or not it ends up flagged. Used by flags and by outcome checks. */
export function measureSku(input: SkuInput, runDate: string, s: RuleSettings): Measure {
  // The most recent complete week is the one before the week containing the run date.
  const lastWeek = addDays(mondayOf(runDate), -7);
  const window = Array.from({ length: s.baseline_weeks }, (_, i) => addDays(lastWeek, -7 * i)); // newest first

  let historyWeeks = 0;
  let firstWeek: string | null = null;
  for (const week of input.sales.keys()) {
    if (week > lastWeek) continue; // never look past the run date
    historyWeeks++;
    if (firstWeek === null || week < firstWeek) firstWeek = week;
  }
  // A gap is a missing week inside the window AFTER the SKU's first sale. Weeks before launch are not gaps.
  const missingWeeks = firstWeek === null ? 0 : window.filter((w) => w >= firstWeek! && !input.sales.has(w)).length;

  const present = window.filter((w) => input.sales.has(w)).map((w) => input.sales.get(w)!);
  const recentPresent = window.slice(0, s.recent_weeks).filter((w) => input.sales.has(w)).map((w) => input.sales.get(w)!);
  const avgBaseline = mean(present);
  const avgRecent = mean(recentPresent);

  // 1. Season factor
  const seasonFactor = s.season_months.includes(monthOf(runDate)) ? s.season_uplift : 1;
  const demandBaseline = s.season_mode === "baseline" ? avgBaseline * seasonFactor : avgBaseline;
  const stockBaseline = avgBaseline * seasonFactor; // both modes uplift the weeks-of-stock demand figure

  const ratio = demandBaseline > 0 ? avgRecent / demandBaseline : null;
  const wos = stockBaseline > 0 ? input.stock / stockBaseline : null;
  const perishable = input.is_perishable;
  const minWeeks = perishable ? s.perishable_min_weeks : s.stockout_weeks;
  const maxWeeks = perishable ? s.perishable_max_weeks : s.overstock_weeks;

  // 2. Needs judgment
  const triggers: JudgmentTrigger[] = [];
  if (historyWeeks < s.judgment_min_history_weeks) triggers.push("short_history");
  if (missingWeeks > s.judgment_max_missing_weeks) triggers.push("missing_weeks");
  if (avgBaseline === 0) triggers.push("no_sales");
  else if (ratio !== null && ratio > s.judgment_ratio_high + EPS) triggers.push("demand_surge");
  else if (ratio !== null && ratio < s.judgment_ratio_low - EPS) triggers.push("demand_drop");

  // 3 and 4. What the stock windows and the demand rule say (computed for every SKU, used for context if it needs judgment)
  const types: FlagType[] = [];
  if (wos !== null) {
    if (wos < minWeeks - EPS) types.push("stockout_risk");
    else if (wos > maxWeeks + EPS) types.push("overstock_risk");
  }
  if (ratio !== null && avgRecent > demandBaseline * (1 + s.high_demand_pct / 100) + EPS) types.push("high_demand");

  const numbers: FlagNumbers = {
    run_date: runDate,
    stock: input.stock,
    standard_order_qty: input.standard_order_qty,
    avg_recent: r2(avgRecent),
    avg_baseline: r2(avgBaseline),
    season_factor: seasonFactor,
    season_mode: s.season_mode,
    demand_baseline: r2(demandBaseline),
    stock_baseline: r2(stockBaseline),
    weeks_of_stock: wos === null ? null : r2(wos),
    recent_vs_baseline: ratio === null ? null : r2(ratio),
    window_type: perishable ? "perishable" : "standard",
    min_weeks: minWeeks,
    max_weeks: maxWeeks,
    recent_weeks: s.recent_weeks,
    baseline_weeks: s.baseline_weeks,
    history_weeks: historyWeeks,
    missing_weeks: missingWeeks,
    triggers,
    context_flags: [],
    conflict: false,
  };

  return { numbers, types, triggers };
}

/** Returns the flag for one SKU on one run date, or null when the SKU needs no action. */
export function evaluateSku(input: SkuInput, runDate: string, s: RuleSettings): Evaluation | null {
  const { numbers, types, triggers } = measureSku(input, runDate, s);
  if (triggers.length) {
    // Never auto-recommend a quantity for these. Raghav decides.
    return {
      sku_id: input.sku_id,
      flag_type: "needs_judgment",
      also_types: [],
      urgent: false,
      recommended_qty: null,
      numbers: { ...numbers, context_flags: types },
    };
  }
  if (!types.length) return null;

  const high = types.includes("high_demand");
  const stockout = types.includes("stockout_risk");
  const overstock = types.includes("overstock_risk");

  if (overstock && high) {
    // High demand but a huge pile of stock: the two rules point in opposite directions.
    // Keep both flags, recommend nothing, and let Raghav decide.
    return { sku_id: input.sku_id, flag_type: "overstock_risk", also_types: ["high_demand"], urgent: false, recommended_qty: null, numbers: { ...numbers, conflict: true } };
  }
  if (high) {
    return {
      sku_id: input.sku_id,
      flag_type: "high_demand",
      also_types: stockout ? ["stockout_risk"] : [],
      urgent: stockout,
      recommended_qty: Math.round(input.standard_order_qty * s.high_demand_multiplier),
      numbers,
    };
  }
  if (stockout) return { sku_id: input.sku_id, flag_type: "stockout_risk", also_types: [], urgent: false, recommended_qty: input.standard_order_qty, numbers };
  return { sku_id: input.sku_id, flag_type: "overstock_risk", also_types: [], urgent: false, recommended_qty: null, numbers };
}

/** Runs the rules over every SKU. Order of the input is kept; SKUs with no flag are left out. */
export function evaluateAll(inputs: SkuInput[], runDate: string, s: RuleSettings): Evaluation[] {
  const out: Evaluation[] = [];
  for (const input of inputs) {
    const e = evaluateSku(input, runDate, s);
    if (e) out.push(e);
  }
  return out;
}
