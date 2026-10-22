// Reads the data behind the four kill criteria and evaluates them. Read-only: this never changes anything.

import type { Sql } from "../db/client";
import { evaluateK1, evaluateK2, evaluateK3, evaluateK4, type Criterion } from "./criteria";

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

async function settingsMap(sql: Sql) {
  return Object.fromEntries(((await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[]).map((r) => [r.key, r.value])) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function k3Counts(sql: Sql, goLive: string, afterWeeks: number) {
  const start = addDays(goLive, afterWeeks * 7);
  const [c] = (await sql.query(
    "select count(*)::int as decided, count(*) filter (where status = 'overridden')::int as overridden from flags where status <> 'pending' and (decided_at at time zone 'Asia/Kolkata')::date >= $1::date", [start])) as { decided: number; overridden: number }[];
  return c;
}

/** Just K3, for the banner shown on every page. */
export async function loadK3(sql: Sql, today: string): Promise<Criterion> {
  const s = await settingsMap(sql);
  const goLive = typeof s.go_live_date === "string" ? s.go_live_date : null;
  const c = goLive ? await k3Counts(sql, goLive, Number(s.k3_after_weeks)) : { decided: 0, overridden: 0 };
  return evaluateK3({ goLive, today, afterWeeks: Number(s.k3_after_weeks), decided: c.decided, overridden: c.overridden, threshold: Number(s.k3_override_pct), amber: Number(s.k3_amber_pct) });
}

export async function loadCriteria(sql: Sql, today: string): Promise<Criterion[]> {
  const s = await settingsMap(sql);
  const goLive = typeof s.go_live_date === "string" ? s.go_live_date : null;

  // K1: are the latest imports clean, and how fresh is the data?
  const imports = (await sql.query("select distinct on (kind) kind, rows_rejected from import_log where kind in ('sales','stock','skus') order by kind, id desc")) as { kind: string; rows_rejected: number }[];
  const importsClean = imports.length === 3 ? imports.every((i) => i.rows_rejected === 0) : imports.length === 0 ? null : false;
  const [newest] = (await sql.query("select to_char(max(week_start),'YYYY-MM-DD') as d from weekly_sales")) as { d: string | null }[];
  const k1 = evaluateK1({ today, projectStart: String(s.project_start_date), day: Number(s.k1_day), automatedConfirmed: s.k1_export_automated === true, importsClean, dataAgeDays: newest?.d ? daysBetween(newest.d, today) - 6 : null });

  // K2: the latest backtest
  const [bt] = (await sql.query("select run_at, summary from backtest_results order by id desc limit 1")) as { run_at: string; summary: { caught_pct: number; chance?: { lift: number } } }[];
  const k2 = evaluateK2({ caughtPct: bt?.summary.caught_pct ?? null, lift: bt?.summary.chance?.lift ?? null, minPct: Number(s.k2_min_catch_pct), amberMargin: Number(s.k2_amber_margin), ranAt: bt?.run_at ?? null });

  // K3: override rate from week 6 live
  const k3 = await loadK3(sql, today);

  // K4: each live quarter against the same dates a year earlier
  const quarters = Number(s.k4_quarters);
  const periods: { measured: number; lastYear: number | null }[] = [];
  if (goLive && daysBetween(goLive, today) >= 91 * quarters) {
    for (let p = 0; p < quarters; p++) {
      const from = addDays(goLive, p * 91), to = addDays(goLive, (p + 1) * 91);
      const sum = async (a: string, b: string) => Number(((await sql.query("select coalesce(sum(value_inr),0)::float8 as v from loss_events where week_start >= $1::date and week_start < $2::date", [a, b])) as { v: number }[])[0].v);
      const last = await sum(addDays(from, -364), addDays(to, -364));
      periods.push({ measured: await sum(from, to), lastYear: last > 0 ? last : null });
    }
  }
  const k4 = evaluateK4({ goLive, today, quarters, periods, targetPct: Number(s.k4_target_pct) });
  return [k1, k2, k3, k4];
}
