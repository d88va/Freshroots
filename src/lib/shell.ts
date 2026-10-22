// What the app shell shows on every page: counts for the sidebar, whether the system is running, and K3 for the banner.
import type { Sql } from "./db/client";
import type { Criterion } from "./kill/criteria";
import { loadK3 } from "./kill/load";
import { asOfDate, getPauseState, type PauseState } from "./run/state";
import { nextScheduledRun } from "./run/schedule";

export interface ShellData { reviewCount: number; feedbackCount: number; k3: Criterion | null; pause: PauseState; nextRun: string }

export async function loadShell(sql: Sql): Promise<ShellData | null> {
  try {
    const today = await asOfDate(sql);
    const [review, feedback, pause, k3] = await Promise.all([
      (sql.query("select count(*)::int as n from flags where status = 'pending'") as unknown as Promise<{ n: number }[]>),
      (sql.query("select count(*)::int as n from suggestions where status = 'open'") as unknown as Promise<{ n: number }[]>),
      getPauseState(sql),
      loadK3(sql, today),
    ]);
    const nextRun = nextScheduledRun(new Date()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    return { reviewCount: review[0].n, feedbackCount: feedback[0].n, k3, pause, nextRun };
  } catch {
    return null; // never let the shell take a page down
  }
}
