// Saving a rule change. The ONLY ways a rule changes are: Raghav accepts or edits a suggestion, or Raghav edits the
// Settings page. Both come through here. Every change is validated, saved with his reason, and written to the version
// history in one atomic step. The next run reads the new value.

import type { Sql } from "../db/client";
import { DEFAULT_SETTINGS, parseSettings, type RuleSettings } from "./engine";

export const RULE_LABELS: Record<string, string> = {
  high_demand_pct: "High demand: % above the 12-week average",
  high_demand_multiplier: "High demand: reorder multiple",
  recent_weeks: "Recent sales window (weeks)",
  baseline_weeks: "Baseline window (weeks)",
  stockout_weeks: "Stockout risk: below this many weeks of stock",
  overstock_weeks: "Overstock risk: above this many weeks of stock",
  perishable_min_weeks: "Perishables: minimum weeks of stock",
  perishable_max_weeks: "Perishables: maximum weeks of stock",
  season_months: "Season months",
  season_uplift: "Season uplift",
  season_mode: "Season mode",
  judgment_min_history_weeks: "Needs judgment: fewer weeks of history than",
  judgment_max_missing_weeks: "Needs judgment: more missing weeks than",
  judgment_ratio_high: "Needs judgment: recent sales above this multiple of baseline",
  judgment_ratio_low: "Needs judgment: recent sales below this multiple of baseline",
};

type Check = (v: unknown) => string | null;
const num = (lo: number, hi: number): Check => (v) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? null : `must be a number from ${lo} to ${hi}`);
const int = (lo: number, hi: number): Check => (v) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? null : `must be a whole number from ${lo} to ${hi}`);
const CHECKS: Record<keyof RuleSettings, Check> = {
  high_demand_pct: num(1, 500), high_demand_multiplier: num(1, 5), recent_weeks: int(1, 12), baseline_weeks: int(4, 52),
  stockout_weeks: num(0.5, 52), overstock_weeks: num(1, 104), perishable_min_weeks: num(0.5, 26), perishable_max_weeks: num(1, 52),
  season_months: (v) => (Array.isArray(v) && v.length <= 12 && v.every((m) => Number.isInteger(m) && m >= 1 && m <= 12) && new Set(v).size === v.length ? null : "must be a list of different months, 1 to 12"),
  season_uplift: num(1, 3), season_mode: (v) => (v === "baseline" || v === "weeks_check_only" ? null : 'must be "baseline" or "weeks_check_only"'),
  judgment_min_history_weeks: int(1, 52), judgment_max_missing_weeks: int(0, 12), judgment_ratio_high: num(1, 20), judgment_ratio_low: num(0.01, 1),
};

/** Returns a list of problems with applying `changes` on top of `current`. Empty means it is safe to save. */
export function validateChange(current: RuleSettings, changes: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const keys = Object.keys(changes);
  if (!keys.length) return ["Nothing to change."];
  for (const k of keys) {
    if (!(k in CHECKS)) { errors.push(`"${k}" is not a rule setting.`); continue; }
    const problem = CHECKS[k as keyof RuleSettings](changes[k]);
    if (problem) errors.push(`${RULE_LABELS[k] ?? k} ${problem}.`);
  }
  if (errors.length) return errors;
  const next = { ...current, ...changes } as RuleSettings;
  if (next.stockout_weeks >= next.overstock_weeks) errors.push("The stockout limit must be lower than the overstock limit.");
  if (next.perishable_min_weeks >= next.perishable_max_weeks) errors.push("The perishable minimum must be lower than the perishable maximum.");
  if (next.recent_weeks >= next.baseline_weeks) errors.push("The recent window must be shorter than the baseline window.");
  if (next.judgment_ratio_low >= next.judgment_ratio_high) errors.push("The low ratio must be below the high ratio.");
  return errors;
}

export type SaveResult = { ok: true; versionId: number; changes: Record<string, { from: unknown; to: unknown }> } | { ok: false; errors: string[] };

/** `alsoInTransaction` adds more statements to the same atomic step (used to mark a suggestion as resolved together with the change). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveRuleChange(sql: Sql, o: { changes: Record<string, unknown>; reason: string; by?: string; alsoInTransaction?: () => any[] }): Promise<SaveResult> {
  const reason = o.reason.trim();
  if (!reason) return { ok: false, errors: ["Please give a reason. It is saved with the new rule version."] };
  const rows = (await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[];
  const current = parseSettings(rows);
  const errors = validateChange(current, o.changes);
  if (errors.length) return { ok: false, errors };

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(o.changes)) {
    const from = (current as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(from) !== JSON.stringify(v)) diff[k] = { from, to: v };
  }
  if (!Object.keys(diff).length) return { ok: false, errors: ["That is already the current value."] };

  // One atomic step: the new values and the history entry are saved together or not at all.
  const queries = [
    ...Object.entries(diff).map(([k, d]) => sql.query("update rule_settings set value = $2, updated_at = now() where key = $1", [k, JSON.stringify(d.to)])),
    sql.query("insert into rule_versions (saved_by, changes, reason) values ($1, $2, $3) returning id", [o.by ?? "raghav", JSON.stringify(diff), reason]),
    ...(o.alsoInTransaction?.() ?? []),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = (await sql.transaction(queries as any)) as { id: number }[][];
  return { ok: true, versionId: Number(results[Object.keys(diff).length][0].id), changes: diff };
}

export const DEFAULTS_FOR_REFERENCE = DEFAULT_SETTINGS;

/** Turns what Raghav typed into the right kind of value for a setting: "9, 10, 11" for the season months, a number for the rest. */
export function parseSettingValue(key: string, raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const t = raw.trim();
  if (key === "season_months") return t === "" ? [] : t.split(/[,\s]+/).map(Number);
  if (key === "season_mode") return t;
  return t === "" ? NaN : Number(t);
}

export interface RuleField { key: keyof RuleSettings; type: "num" | "months" | "mode"; group: string; help: string }
/** The rule settings as shown on the Settings page, grouped the way Raghav thinks about them. */
export const RULE_FIELDS: RuleField[] = [
  { key: "stockout_weeks", type: "num", group: "Stock windows", help: "Below this many weeks of sales: stockout risk (non-perishables)." },
  { key: "overstock_weeks", type: "num", group: "Stock windows", help: "Above this many weeks of sales: overstock risk (non-perishables)." },
  { key: "perishable_min_weeks", type: "num", group: "Stock windows", help: "Perishables use this INSTEAD of the stockout limit." },
  { key: "perishable_max_weeks", type: "num", group: "Stock windows", help: "Perishables use this INSTEAD of the overstock limit." },
  { key: "high_demand_pct", type: "num", group: "Demand", help: "Last 4 weeks more than this % above the 12-week average: high demand." },
  { key: "high_demand_multiplier", type: "num", group: "Demand", help: "High demand recommends this many times the standard order." },
  { key: "recent_weeks", type: "num", group: "Demand", help: "The recent window." },
  { key: "baseline_weeks", type: "num", group: "Demand", help: "The baseline window." },
  { key: "season_months", type: "months", group: "Season", help: "Months that get the uplift, as numbers: 3, 10, 11." },
  { key: "season_uplift", type: "num", group: "Season", help: "The uplift, applied before any threshold check (1.25 = 25%)." },
  { key: "season_mode", type: "mode", group: "Season", help: "The open question for Raghav: uplift the 12-week baseline (default), or only the weeks-of-stock check." },
  { key: "judgment_min_history_weeks", type: "num", group: "Needs judgment", help: "Fewer weeks of sales history than this: needs judgment (new launch)." },
  { key: "judgment_max_missing_weeks", type: "num", group: "Needs judgment", help: "More missing weeks than this in the last 12: needs judgment." },
  { key: "judgment_ratio_high", type: "num", group: "Needs judgment", help: "Recent sales above this multiple of the baseline: needs judgment." },
  { key: "judgment_ratio_low", type: "num", group: "Needs judgment", help: "Recent sales below this multiple of the baseline: needs judgment." },
];
