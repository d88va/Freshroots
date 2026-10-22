import { getSql } from "@/lib/db/client";
import { RULE_LABELS, RULE_FIELDS } from "@/lib/rules/settings";
import { PROJECT_FIELDS } from "@/lib/kill/settings";
import { getPauseState } from "@/lib/run/state";
import { PauseCard, ProjectForm, RulesForm } from "./SettingsForms";

export const dynamic = "force-dynamic";

const ist = (d: unknown) => new Date(d as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "empty" : String(v));

export default async function Settings() {
  const sql = getSql();
  const current = Object.fromEntries(((await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const state = await getPauseState(sql);
  const versions = (await sql.query("select id, saved_at, saved_by, changes, reason from rule_versions order by id desc limit 12")) as { id: number; saved_at: string; saved_by: string; changes: Record<string, { from: unknown; to: unknown }>; reason: string }[];
  const projectLog = (await sql.query("select id, saved_at, saved_by, changes, reason from project_setting_log order by id desc limit 8")) as typeof versions;
  const pauseLog = (await sql.query("select action, at, reason from pause_log order by id desc limit 10")) as { action: string; at: string; reason: string }[];
  const [latestVersion] = (await sql.query("select max(id)::int as v from rule_versions")) as { v: number }[];
  const label = (k: string) => RULE_LABELS[k] ?? PROJECT_FIELDS.find((f) => f.key === k)?.label ?? k;

  return (
    <>
      <h1>Settings</h1>
      <p className="lead">Every threshold the system uses is here. Only you change them, each change needs a reason, and each one is logged.</p>

      <h2 style={{ marginTop: 28 }}>System</h2>
      <PauseCard paused={state.paused} since={state.paused_at} why={state.paused_reason} />

      <h2>Rules (current version {latestVersion.v})</h2>
      <p className="muted" style={{ marginTop: 0 }}>Saving creates a new rule version, used from the next run. The feedback loop can only suggest changes; it cannot save one.</p>
      <RulesForm current={Object.fromEntries(RULE_FIELDS.map((f) => [f.key, current[f.key]]))} />

      <h3 style={{ margin: "16px 0 8px" }}>Rule version history</h3>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Version</th><th>Saved</th><th>By</th><th>Change</th><th>Reason</th></tr></thead>
          <tbody>{versions.map((v) => (
            <tr key={v.id}><td>{v.id}</td><td>{ist(v.saved_at)}</td><td>{v.saved_by}</td>
              <td>{Object.entries(v.changes).map(([k, c]) => c && typeof c === "object" && "to" in c ? <div key={k}>{label(k)}: <strong>{show(c.from)} → {show(c.to)}</strong></div> : <div key={k} className="muted">initial defaults</div>)}</td>
              <td>{v.reason}</td></tr>
          ))}</tbody>
        </table>
      </div>

      <h2>Project dates and kill criteria</h2>
      <p className="muted" style={{ marginTop: 0 }}>These only change what the Metrics page shows. The kill criteria never stop or change anything by themselves.</p>
      <ProjectForm current={current} />

      {projectLog.length > 0 && (
        <>
          <h3 style={{ margin: "16px 0 8px" }}>Project setting change log</h3>
          <div className="card" style={{ overflowX: "auto" }}>
            <table><thead><tr><th>Saved</th><th>By</th><th>Change</th><th>Reason</th></tr></thead>
              <tbody>{projectLog.map((v) => <tr key={v.id}><td>{ist(v.saved_at)}</td><td>{v.saved_by}</td><td>{Object.entries(v.changes).map(([k, c]) => <div key={k}>{label(k)}: <strong>{show(c.from)} → {show(c.to)}</strong></div>)}</td><td>{v.reason}</td></tr>)}</tbody></table>
          </div>
        </>
      )}

      <h2>Pause and resume log</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        {pauseLog.length === 0 ? <span className="muted">The system has never been paused.</span> : (
          <table><thead><tr><th>When (IST)</th><th>Action</th><th>Reason</th></tr></thead>
            <tbody>{pauseLog.map((p, i) => <tr key={i}><td>{ist(p.at)}</td><td><span className={`pill ${p.action === "pause" ? "bad" : "good"}`}>{p.action === "pause" ? "Paused" : "Resumed"}</span></td><td>{p.reason}</td></tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}
