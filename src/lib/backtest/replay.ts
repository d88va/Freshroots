// Backtest: replay the rules week by week over history and ask, for every past stockout and
// write-off, "would the rules have flagged this SKU BEFORE it happened?"
// Pure functions: the data comes in as arguments, nothing is read from the database here.

import { addDays } from "../rules/dates";
import { evaluateSku, type FlagType, type RuleSettings } from "../rules/engine";

export interface BtSku { sku_id: string; is_perishable: boolean; standard_order_qty: number; category: string }
export interface BtLoss { sku_id: string; week_start: string; type: "stockout" | "write_off"; value_inr: number }
export interface BtParams { lookback_weeks: number; min_lead_weeks: number }

export interface BtInput {
  skus: BtSku[];
  sales: Map<string, Map<string, number>>; // sku -> week_start -> units
  stock: Map<string, Map<string, number>>; // sku -> snapshot_date -> units
  losses: BtLoss[];
  settings: RuleSettings;
  params: BtParams;
}

interface Group { events: number; caught: number; value: number; caught_value: number }
export interface BtExample { sku_id: string; type: string; event_week: string; value_inr: number; first_flag: string | null; lead_weeks: number | null; flag_type: string | null }

export interface BtSummary {
  params: BtParams;
  first_run_date: string;
  last_run_date: string;
  runs: number;
  events_total: number;
  events_not_testable: number; // happened before the rules had 12 weeks of history to work with
  events_tested: number;
  caught: number;
  caught_pct: number;
  value_tested_inr: number;
  value_caught_inr: number;
  value_caught_pct: number;
  by_type: Record<string, Group>;
  by_perishable: Record<string, Group>;
  by_year: Record<string, Group>;
  monthly_cycle: { caught: number; caught_pct: number }; // same rules, but run only on the first Monday of each month
  lead_weeks: { weekly_median: number | null; monthly_median: number | null; earlier_by_median: number | null; caught_only_by_weekly: number };
  // What random flagging would have scored: for each loss, the same check on other SKUs of the same kind
  // (perishable or not) in the same weeks. If this is close to the real number, the rules add little.
  chance: { caught_pct: number; stockout_pct: number; write_off_pct: number; lift: number };
  surfaced_for_judgment: number; // missed by the rules, but a needs_judgment flag put the SKU in front of Raghav
  flag_load: { avg_flags_per_run: number; avg_by_type: Record<FlagType, number>; avg_matching_flags_per_run: number };
  flag_hit_rate: { stockout_flags: number; stockout_flags_followed_pct: number; overstock_flags: number; overstock_flags_followed_pct: number };
  examples: { caught: BtExample[]; missed: BtExample[] };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const weeksBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / (7 * 86400000));
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const isFirstMonday = (iso: string) => Number(iso.slice(8, 10)) <= 7;

interface Seen { types: Set<FlagType>; main: FlagType }

export function replay(input: BtInput): BtSummary {
  const { skus, sales, stock, losses, settings, params } = input;

  // Run dates: every Monday from when every SKU has 12 weeks of history until the end of the data.
  let firstSale = "9999-12-31", lastSale = "0000-00-00";
  for (const m of sales.values()) for (const w of m.keys()) { if (w < firstSale) firstSale = w; if (w > lastSale) lastSale = w; }
  const firstRun = addDays(firstSale, 7 * settings.baseline_weeks);
  const lastRun = addDays(lastSale, 7);
  const runDates: string[] = [];
  for (let d = firstRun; d <= lastRun; d = addDays(d, 7)) runDates.push(d);

  // 1. Replay: what would the rules have said on each Monday?
  const flagsBy = new Map<string, Map<string, Seen>>(); // sku -> run date -> flag
  const loadTotals = { all: 0, high_demand: 0, stockout_risk: 0, overstock_risk: 0, needs_judgment: 0, matching: 0 };
  for (const r of runDates) {
    for (const sku of skus) {
      const units = stock.get(sku.sku_id)?.get(r);
      if (units === undefined) continue; // no stock count that day
      const e = evaluateSku({ sku_id: sku.sku_id, is_perishable: sku.is_perishable, standard_order_qty: sku.standard_order_qty, stock: units, sales: sales.get(sku.sku_id) ?? new Map() }, r, settings);
      if (!e) continue;
      if (!flagsBy.has(sku.sku_id)) flagsBy.set(sku.sku_id, new Map());
      flagsBy.get(sku.sku_id)!.set(r, { types: new Set([e.flag_type, ...e.also_types]), main: e.flag_type });
      loadTotals.all++;
      loadTotals[e.flag_type]++;
      if (e.flag_type !== "needs_judgment") loadTotals.matching++;
    }
  }

  const matches = (type: BtLoss["type"], f: Seen) =>
    type === "stockout" ? f.types.has("stockout_risk") || f.types.has("high_demand") : f.types.has("overstock_risk");

  // 2. For each loss, look back for a matching flag.
  const group = (): Group => ({ events: 0, caught: 0, value: 0, caught_value: 0 });
  const by_type: Record<string, Group> = {}, by_perishable: Record<string, Group> = {}, by_year: Record<string, Group> = {};
  const perishable = new Map(skus.map((s) => [s.sku_id, s.is_perishable]));
  const add = (g: Record<string, Group>, key: string, caught: boolean, value: number) => {
    const x = (g[key] ??= group());
    x.events++; x.value += value;
    if (caught) { x.caught++; x.caught_value += value; }
  };

  // SKUs grouped by perishable or not, for the chance baseline
  const groups = { true: skus.filter((x) => x.is_perishable).map((x) => x.sku_id), false: skus.filter((x) => !x.is_perishable).map((x) => x.sku_id) };
  const rng = mulberry32(20261022);
  const CHANCE_SAMPLES = 10;
  const chance = { all: [0, 0], stockout: [0, 0], write_off: [0, 0] }; // [hits, trials]
  const windowHit = (sku: string, type: BtLoss["type"], week: string) => {
    const m = flagsBy.get(sku);
    if (!m) return false;
    for (let k = params.lookback_weeks; k >= params.min_lead_weeks; k--) { const f = m.get(addDays(week, -7 * k)); if (f && matches(type, f)) return true; }
    return false;
  };

  let notTestable = 0, tested = 0, caught = 0, monthlyCaught = 0, onlyWeekly = 0, surfaced = 0, valueTested = 0, valueCaught = 0;
  const weeklyLead: number[] = [], monthlyLead: number[] = [], earlier: number[] = [];
  const caughtEx: BtExample[] = [], missedEx: BtExample[] = [];
  const testableFrom = addDays(firstRun, 7 * params.min_lead_weeks);

  for (const ev of losses) {
    if (ev.week_start < testableFrom) { notTestable++; continue; }
    tested++;
    valueTested += ev.value_inr;
    const skuFlags = flagsBy.get(ev.sku_id);
    let first: { date: string; flag: Seen } | null = null, firstMonthly: string | null = null, judgment = false;
    for (let k = params.lookback_weeks; k >= params.min_lead_weeks; k--) { // oldest day in the window first
      const r = addDays(ev.week_start, -7 * k);
      const f = skuFlags?.get(r);
      if (!f) continue;
      if (matches(ev.type, f)) {
        if (!first) first = { date: r, flag: f };
        if (!firstMonthly && isFirstMonday(r)) firstMonthly = r;
      } else if (f.types.has("needs_judgment")) judgment = true;
    }
    const pool = groups[String(perishable.get(ev.sku_id) ?? false) as "true" | "false"];
    for (let i = 0; i < CHANCE_SAMPLES; i++) {
      const other = pool[Math.floor(rng() * pool.length)];
      if (other === ev.sku_id) continue;
      const hit = windowHit(other, ev.type, ev.week_start) ? 1 : 0;
      chance.all[0] += hit; chance.all[1]++; chance[ev.type][0] += hit; chance[ev.type][1]++;
    }
    const isCaught = first !== null;
    if (isCaught) { caught++; valueCaught += ev.value_inr; weeklyLead.push(weeksBetween(first!.date, ev.week_start)); }
    if (firstMonthly) { monthlyCaught++; monthlyLead.push(weeksBetween(firstMonthly, ev.week_start)); }
    if (isCaught && firstMonthly) earlier.push(weeksBetween(first!.date, ev.week_start) - weeksBetween(firstMonthly, ev.week_start));
    if (isCaught && !firstMonthly) onlyWeekly++;
    if (!isCaught && judgment) surfaced++;
    add(by_type, ev.type, isCaught, ev.value_inr);
    add(by_perishable, perishable.get(ev.sku_id) ? "perishable" : "non_perishable", isCaught, ev.value_inr);
    add(by_year, ev.week_start.slice(0, 4), isCaught, ev.value_inr);
    const ex: BtExample = { sku_id: ev.sku_id, type: ev.type, event_week: ev.week_start, value_inr: ev.value_inr, first_flag: first?.date ?? null, lead_weeks: first ? weeksBetween(first.date, ev.week_start) : null, flag_type: first?.flag.main ?? null };
    (isCaught ? caughtEx : missedEx).push(ex);
  }

  // 3. Are the flags useful, or is the rule just flagging everything? How often is a flag followed by a loss?
  const eventWeeks = new Map<string, string[]>(); // "sku|type" -> weeks
  for (const ev of losses) { const k = `${ev.sku_id}|${ev.type}`; if (!eventWeeks.has(k)) eventWeeks.set(k, []); eventWeeks.get(k)!.push(ev.week_start); }
  const followed = (sku: string, type: BtLoss["type"], r: string) => {
    const lo = addDays(r, 7 * params.min_lead_weeks), hi = addDays(r, 7 * params.lookback_weeks);
    return (eventWeeks.get(`${sku}|${type}`) ?? []).some((w) => w >= lo && w <= hi);
  };
  let so = 0, soHit = 0, os = 0, osHit = 0;
  for (const [sku, m] of flagsBy) for (const [r, f] of m) {
    if (r > addDays(lastSale, -7 * params.lookback_weeks)) continue; // not enough future left to judge
    if (matches("stockout", f)) { so++; if (followed(sku, "stockout", r)) soHit++; }
    if (matches("write_off", f)) { os++; if (followed(sku, "write_off", r)) osHit++; }
  }

  const n = runDates.length;
  const by = (k: keyof typeof loadTotals) => Math.round((loadTotals[k] / n) * 10) / 10;
  const pick = (examples: BtExample[]) => [...examples].sort((a, b) => b.value_inr - a.value_inr).slice(0, 6);
  return {
    params,
    first_run_date: firstRun,
    last_run_date: lastRun,
    runs: n,
    events_total: losses.length,
    events_not_testable: notTestable,
    events_tested: tested,
    caught,
    caught_pct: pct(caught, tested),
    value_tested_inr: Math.round(valueTested),
    value_caught_inr: Math.round(valueCaught),
    value_caught_pct: pct(valueCaught, valueTested),
    by_type, by_perishable, by_year,
    monthly_cycle: { caught: monthlyCaught, caught_pct: pct(monthlyCaught, tested) },
    lead_weeks: { weekly_median: median(weeklyLead), monthly_median: median(monthlyLead), earlier_by_median: median(earlier), caught_only_by_weekly: onlyWeekly },
    chance: {
      caught_pct: pct(chance.all[0], chance.all[1]),
      stockout_pct: pct(chance.stockout[0], chance.stockout[1]),
      write_off_pct: pct(chance.write_off[0], chance.write_off[1]),
      lift: chance.all[0] ? Math.round((caught / tested / (chance.all[0] / chance.all[1])) * 100) / 100 : 0,
    },
    surfaced_for_judgment: surfaced,
    flag_load: {
      avg_flags_per_run: by("all"),
      avg_by_type: { high_demand: by("high_demand"), stockout_risk: by("stockout_risk"), overstock_risk: by("overstock_risk"), needs_judgment: by("needs_judgment") },
      avg_matching_flags_per_run: by("matching"),
    },
    flag_hit_rate: { stockout_flags: so, stockout_flags_followed_pct: pct(soHit, so), overstock_flags: os, overstock_flags_followed_pct: pct(osHit, os) },
    examples: { caught: pick(caughtEx), missed: pick(missedEx) },
  };
}
