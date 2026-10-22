import Link from "next/link";
import { getSql } from "@/lib/db/client";
import { loadK3 } from "@/lib/kill/load";
import { getPauseState } from "@/lib/run/state";
import { todayIST } from "@/lib/run/schedule";

// Shown on every page. A paused system always says so. A red K3 SUGGESTS a pause, but nothing here pauses anything.
export default async function StatusBanners() {
  try {
    const sql = getSql();
    const [state, k3] = await Promise.all([getPauseState(sql), loadK3(sql, todayIST())]);
    return (
      <>
        {state.paused && (
          <div role="status" style={{ background: "var(--soft-bad)", color: "var(--bad)", borderBottom: "2px solid var(--bad)" }}>
            <div className="inner" style={{ maxWidth: 1100, margin: "0 auto", padding: "10px 16px" }}>
              <strong>System paused.</strong> The schedule, Run now and the outcome check are blocked. Existing flags stay visible.
              {state.paused_reason ? <> Reason: {state.paused_reason}.</> : null} <Link href="/settings#pause" style={{ color: "inherit", textDecoration: "underline" }}>Resume on the Settings page</Link>
            </div>
          </div>
        )}
        {!state.paused && k3.status === "red" && (
          <div role="status" style={{ background: "var(--soft-warn)", color: "var(--warn)", borderBottom: "2px solid var(--warn)" }}>
            <div className="inner" style={{ maxWidth: 1100, margin: "0 auto", padding: "10px 16px" }}>
              <strong>K3 is red: consider pausing.</strong> {k3.current}. The pause line is a stop signal for you, not for the system: it will not pause itself. <Link href="/settings#pause" style={{ color: "inherit", textDecoration: "underline" }}>Pause on the Settings page</Link>
            </div>
          </div>
        )}
      </>
    );
  } catch {
    return null; // never let a banner take a page down
  }
}
