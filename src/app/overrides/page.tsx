import { getSql } from "@/lib/db/client";
import { decidedFlags } from "@/lib/review/data";
import { TAGS, TAG_LABELS, type Tag } from "@/lib/review/decide";

export const dynamic = "force-dynamic";

const when = (d: unknown) => new Date(d as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const TYPE: Record<string, string> = { high_demand: "High demand", stockout_risk: "Stockout risk", overstock_risk: "Overstock risk", needs_judgment: "Needs judgment" };

export default async function Overrides() {
  const all = await decidedFlags(getSql());
  const overrides = all.filter((f) => f.status === "overridden");
  const pct = all.length ? Math.round((overrides.length / all.length) * 100) : 0;
  const count = (tag: Tag, rows = all) => rows.filter((f) => f.decision_tag === tag).length;
  const untagged = all.filter((f) => !f.decision_tag).length;

  return (
    <>
      <h1>Override log</h1>
      <p className="lead">Every flag Raghav overrode, with his reason. These are what the feedback loop learns from.</p>

      <div className="pills">
        <span className="pill">{all.length} decided</span>
        <span className="pill warn">{overrides.length} overridden ({pct}%)</span>
        <span className="pill good">{all.filter((f) => f.status === "approved").length} approved</span>
        <span className="pill">{all.filter((f) => f.status === "edited").length} edited</span>
      </div>

      <div className="card">
        <strong>Reason tags across all decisions</strong>
        <table>
          <thead><tr><th>Tag</th><th>Overrides</th><th>All decisions</th></tr></thead>
          <tbody>
            {TAGS.map((t) => <tr key={t}><td>{TAG_LABELS[t]}</td><td>{count(t, overrides)}</td><td>{count(t)}</td></tr>)}
            <tr><td className="muted">No tag (approve or edit only)</td><td>0</td><td>{untagged}</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Overrides ({overrides.length})</h2>
      {overrides.length === 0 ? (
        <div className="card empty">No overrides yet.</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>When</th><th>SKU</th><th>Flag</th><th>Recommended</th><th>Tag</th><th>His note</th><th>AI reason rating</th></tr></thead>
            <tbody>
              {overrides.map((f) => (
                <tr key={f.id}>
                  <td>{when(f.decided_at)}</td>
                  <td>{f.sku_id}<div className="muted">{f.name}</div></td>
                  <td>{TYPE[f.flag_type]}{f.urgent ? " (urgent)" : ""}</td>
                  <td>{f.recommended_qty === null ? (f.flag_type === "overstock_risk" ? "pause" : "none") : `${f.recommended_qty.toLocaleString("en-IN")} units`}</td>
                  <td><span className="pill info">{TAG_LABELS[f.decision_tag as Tag]}</span></td>
                  <td>{f.override_reason ?? <span className="muted">-</span>}</td>
                  <td>{f.reason_rating === "up" ? "👍" : f.reason_rating === "down" ? "👎" : <span className="muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
