import { getSql } from "@/lib/db/client";
import { nextScheduledRun } from "@/lib/run/schedule";
import RunPanel from "./RunPanel";

export const dynamic = "force-dynamic";

interface RunRow {
  id: number; started_at: string; finished_at: string | null; trigger: string; status: string; run_date: string | null;
  flagged_total: number | null; flags_new: number | null; flags_refreshed: number | null; flags_unchanged: number | null; flags_held: number | null;
  ai_reasons: number | null; rule_version_id: number | null; note: string | null; error: string | null;
}
const ist = (d: unknown, opts: Intl.DateTimeFormatOptions) => new Date(d as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
const dash = (n: number | null) => (n === null ? "-" : n);
const STATUS: Record<string, string> = { succeeded: "good", failed: "bad", blocked: "warn", skipped: "warn", running: "info" };
const LABEL: Record<string, string> = { succeeded: "Done", failed: "Failed", blocked: "Blocked: paused", skipped: "Skipped", running: "Running" };

export default async function Runs() {
  const sql = getSql();
  const runs = (await sql.query(
    `select id, started_at, finished_at, trigger, status, to_char(run_date, 'YYYY-MM-DD') as run_date, flagged_total, flags_new, flags_refreshed, flags_unchanged, flags_held, ai_reasons, rule_version_id, note, error
       from runs order by id desc limit 40`)) as RunRow[];
  const [{ paused }] = (await sql.query("select paused from system_state where id = 1")) as { paused: boolean }[];
  const [{ n: aiWaiting }] = (await sql.query("select count(*)::int as n from flags where status = 'pending' and reason_source = 'template' and reason_fallback in ('not_yet','rate_limited','api_error','timeout')")) as { n: number }[];
  const next = nextScheduledRun(new Date());

  return (
    <>
      <h1>Runs</h1>
      <p className="lead">The rules run automatically every Monday and Thursday at 7:00 am IST. You can also run them now.</p>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="muted">Next scheduled run</div>
            <strong>{ist(next, { weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} IST</strong>
            {paused && <div className="err">Paused: the scheduled run will be blocked.</div>}
          </div>
          <RunPanel paused={paused} aiWaiting={aiWaiting} />
        </div>
      </div>

      <h2>Run history</h2>
      {runs.length === 0 ? <div className="card empty">No runs yet. Press Run now.</div> : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>#</th><th>Started (IST)</th><th>Trigger</th><th>Status</th><th title="SKUs the rules flagged">Flagged</th><th title="New pending flags">New</th><th title="Pending flags updated because the numbers changed">Updated</th><th title="Pending flags already up to date">Already pending</th><th title="Flagged by the rules, but decided in the last few days, so not flagged again yet">Held back</th><th>AI reasons</th><th title="The rule version this run used">Rules</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{ist(r.started_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{r.run_date ? <div className="muted">data as of {r.run_date}</div> : null}</td>
                  <td>{r.trigger === "cron" ? "Schedule" : r.trigger === "manual" ? "Run now" : "Upload"}</td>
                  <td><span className={`pill ${STATUS[r.status] ?? ""}`}>{LABEL[r.status] ?? r.status}</span>{r.note ? <div className="muted">{r.note}</div> : null}{r.error ? <div className="err">{r.error}</div> : null}</td>
                  <td>{dash(r.flagged_total)}</td><td>{dash(r.flags_new)}</td><td>{dash(r.flags_refreshed)}</td><td>{dash(r.flags_unchanged)}</td><td>{dash(r.flags_held)}</td><td>{dash(r.ai_reasons)}</td><td>{r.rule_version_id ? `v${r.rule_version_id}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Why running twice never doubles a flag</h2>
      <div className="card">
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li><strong>The database refuses duplicates.</strong> A SKU can have only one pending flag. A second one cannot be saved, even if two runs start at the same moment.</li>
          <li><strong>Runs do not overlap.</strong> If a run is in progress, another one is skipped and recorded as “Skipped”.</li>
          <li><strong>A pending flag is updated, not repeated.</strong> If the numbers have changed since the last run, the existing flag is refreshed in place. If not, it is left alone.</li>
          <li><strong>A decided SKU is held back for 7 days.</strong> Once Raghav approves, edits or overrides a SKU, it is not flagged again straight away. Otherwise the stock would not have arrived yet and the same SKU would be flagged again, inviting a double order. The number of days is the <code>reflag_cooldown_days</code> setting (0 turns it off).</li>
        </ol>
      </div>
    </>
  );
}
