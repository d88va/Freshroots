import type { Sql } from "../db/client";
import { todayIST } from "./schedule";

export interface PauseState { paused: boolean; paused_at: string | null; paused_reason: string | null }

export async function getPauseState(sql: Sql): Promise<PauseState> {
  const [s] = (await sql.query("select paused, paused_at, paused_reason from system_state where id = 1")) as PauseState[];
  return s ?? { paused: false, paused_at: null, paused_reason: null };
}

/** True while the Pause switch is on. Runs, Run now and the outcome check all stop while it is. */
export async function isPaused(sql: Sql): Promise<boolean> {
  return (await getPauseState(sql)).paused;
}

export type PauseResult = { ok: true } | { ok: false; error: string; status: number };

/**
 * Pause or resume. Only Raghav or the owner does this, by hand: the system never pauses itself, even when K3 is red.
 * The state change and its log entry are saved together or not at all, and both need a reason.
 * (There is no app password in this build, so resuming needs a typed reason instead.)
 */
export async function setPaused(sql: Sql, pause: boolean, reasonRaw: string): Promise<PauseResult> {
  const reason = reasonRaw.trim();
  if (!reason) return { ok: false, error: pause ? "Say why you are pausing the system." : "Say why you are resuming the system.", status: 422 };
  const from = !pause; // the state it must currently be in
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = (await sql.transaction([
    sql.query("insert into pause_log (action, reason) select $1, $2 where (select paused from system_state where id = 1) = $3 returning id", [pause ? "pause" : "resume", reason, from]),
    sql.query("update system_state set paused = $1, paused_at = case when $1 then now() else null end, paused_reason = case when $1 then $2 else null end where id = 1 and paused = $3 returning id", [pause, reason, from]),
  ] as any)) as unknown[][];
  if (!results[1].length) return { ok: false, error: pause ? "The system is already paused." : "The system is not paused.", status: 409 };
  return { ok: true };
}

/**
 * The date the app treats as "today": the run date override if one is set (demo only), otherwise today in India.
 * The synthetic demo data stops in October 2026, so a demo sets this and the rules keep working on any later day.
 */
export async function asOfDate(sql: Sql): Promise<string> {
  const [r] = (await sql.query("select value from rule_settings where key = 'run_date_override'")) as { value: unknown }[];
  return typeof r?.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.value) ? r.value : todayIST();
}
