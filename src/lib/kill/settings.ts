// Project and kill-criteria settings: the start date, go-live date, the stop lines. They have their own change log.
// (Rule thresholds are saved by saveRuleChange and versioned in rule_versions.)

import type { Sql } from "../db/client";

export interface ProjectField { key: string; label: string; help: string; type: "date" | "int" | "num" | "bool"; group: string }

export const PROJECT_FIELDS: ProjectField[] = [
  { key: "project_start_date", label: "Project start date", help: "Day 30 for K1 counts from here.", type: "date", group: "Project dates" },
  { key: "go_live_date", label: "Go-live date", help: "The first day Raghav used the system for real. K3 and K4 count from here. Leave empty until then.", type: "date", group: "Project dates" },
  { key: "run_date_override", label: "Run date override (demo only)", help: "Leave EMPTY for real use. The demo data ends in October 2026, so runs and the Metrics page pretend today is this date.", type: "date", group: "Project dates" },
  { key: "k1_day", label: "K1: day limit", help: "The SAP export must be automated and clean by this day.", type: "int", group: "Kill criteria (they only show status)" },
  { key: "k1_export_automated", label: "K1: scheduled SAP export confirmed", help: "Tick only when IT confirms a scheduled export is running. In this demo build the data is synthetic CSV.", type: "bool", group: "Kill criteria (they only show status)" },
  { key: "k2_min_catch_pct", label: "K2: stop below this % caught", help: "Share of past losses the rules must have flagged in the backtest.", type: "num", group: "Kill criteria (they only show status)" },
  { key: "k2_amber_margin", label: "K2: amber margin (points)", help: "Amber when within this many points above the stop line.", type: "num", group: "Kill criteria (they only show status)" },
  { key: "k3_override_pct", label: "K3: pause above this % overridden", help: "Raghav overriding more than this is the pause signal.", type: "num", group: "Kill criteria (they only show status)" },
  { key: "k3_amber_pct", label: "K3: amber above this % overridden", help: "The warning level below the pause line.", type: "num", group: "Kill criteria (they only show status)" },
  { key: "k3_after_weeks", label: "K3: measure from this many weeks live", help: "Overrides before this are not counted.", type: "int", group: "Kill criteria (they only show status)" },
  { key: "k4_quarters", label: "K4: quarters of data needed", help: "Losses are compared with last year once this many full quarters are live.", type: "int", group: "Kill criteria (they only show status)" },
  { key: "k4_target_pct", label: "K4: target reduction %", help: "From the pre-build map: recover at least 25% of the quarterly loss.", type: "num", group: "Kill criteria (they only show status)" },
  { key: "suggest_override_count", label: "Suggest after this many overrides of one rule in a month", help: "Feedback loop.", type: "int", group: "Feedback loop" },
  { key: "suggest_tag_count", label: "Suggest after the same reason tag this many times in a month", help: "Feedback loop.", type: "int", group: "Feedback loop" },
  { key: "outcome_check_days", label: "Check outcomes after this many days", help: "Feedback loop.", type: "int", group: "Feedback loop" },
  { key: "reflag_cooldown_days", label: "Do not flag a decided SKU again for this many days", help: "0 turns the hold-back off.", type: "int", group: "Runs" },
];

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const intIn = (lo: number, hi: number) => (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? null : `must be a whole number from ${lo} to ${hi}`);
const numIn = (lo: number, hi: number) => (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? null : `must be a number from ${lo} to ${hi}`);
const CHECKS: Record<string, (v: unknown) => string | null> = {
  project_start_date: (v) => (isDate(v) ? null : "must be a real date (2026-05-26)"),
  go_live_date: (v) => (v === null || isDate(v) ? null : "must be a real date, or empty"),
  run_date_override: (v) => (v === null || isDate(v) ? null : "must be a real date, or empty"),
  k1_day: intIn(1, 365), k1_export_automated: (v) => (typeof v === "boolean" ? null : "must be on or off"),
  k2_min_catch_pct: numIn(1, 100), k2_amber_margin: numIn(0, 50), k3_override_pct: numIn(1, 100), k3_amber_pct: numIn(1, 100),
  k3_after_weeks: intIn(1, 26), k4_quarters: intIn(1, 8), k4_target_pct: numIn(1, 100),
  suggest_override_count: intIn(1, 200), suggest_tag_count: intIn(1, 200), outcome_check_days: intIn(7, 90), reflag_cooldown_days: intIn(0, 60),
};

export function validateProject(current: Record<string, unknown>, changes: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const label = (k: string) => PROJECT_FIELDS.find((f) => f.key === k)?.label ?? k;
  if (!Object.keys(changes).length) return ["Nothing to change."];
  for (const [k, v] of Object.entries(changes)) {
    const check = CHECKS[k];
    if (!check) { errors.push(`"${k}" is not a project setting.`); continue; }
    const problem = check(v);
    if (problem) errors.push(`${label(k)} ${problem}.`);
  }
  if (errors.length) return errors;
  const next = { ...current, ...changes } as Record<string, unknown>;
  if (typeof next.go_live_date === "string" && typeof next.project_start_date === "string" && next.go_live_date < next.project_start_date) errors.push("The go-live date cannot be before the project start date.");
  if (Number(next.k3_amber_pct) >= Number(next.k3_override_pct)) errors.push("The K3 amber level must be below the K3 pause line.");
  return errors;
}

/** What Raghav typed into the form, as the right kind of value. */
export function parseProjectValue(key: string, raw: unknown): unknown {
  const f = PROJECT_FIELDS.find((x) => x.key === key);
  if (!f || typeof raw !== "string") return raw;
  const t = raw.trim();
  if (f.type === "date") return t === "" ? null : t;
  if (f.type === "bool") return t === "true";
  return t === "" ? NaN : Number(t);
}

export type SaveProjectResult = { ok: true; logId: number } | { ok: false; errors: string[] };

export async function saveProjectSettings(sql: Sql, o: { changes: Record<string, unknown>; reason: string; by?: string }): Promise<SaveProjectResult> {
  const reason = o.reason.trim();
  if (!reason) return { ok: false, errors: ["Please give a reason. It is saved in the change log."] };
  const rows = (await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[];
  const current = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const errors = validateProject(current, o.changes);
  if (errors.length) return { ok: false, errors };
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(o.changes)) if (JSON.stringify(current[k]) !== JSON.stringify(v)) diff[k] = { from: current[k] ?? null, to: v };
  if (!Object.keys(diff).length) return { ok: false, errors: ["That is already the current value."] };
  const queries = [
    ...Object.entries(diff).map(([k, d]) => sql.query("update rule_settings set value = $2, updated_at = now() where key = $1", [k, JSON.stringify(d.to)])),
    sql.query("insert into project_setting_log (saved_by, changes, reason) values ($1,$2,$3) returning id", [o.by ?? "raghav", JSON.stringify(diff), reason]),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = (await sql.transaction(queries as any)) as { id: number }[][];
  return { ok: true, logId: Number(results[Object.keys(diff).length][0].id) };
}
