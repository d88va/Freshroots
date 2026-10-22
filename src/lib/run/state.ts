import type { Sql } from "../db/client";

/** True while the Pause switch is on. Runs, Run now and the outcome check all stop while it is. */
export async function isPaused(sql: Sql): Promise<boolean> {
  const [s] = (await sql.query("select paused from system_state where id = 1")) as { paused: boolean }[];
  return !!s?.paused;
}
