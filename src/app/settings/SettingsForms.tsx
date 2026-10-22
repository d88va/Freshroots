"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RULE_FIELDS, RULE_LABELS } from "@/lib/rules/settings";
import { PROJECT_FIELDS } from "@/lib/kill/settings";

const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v));

function useSave(url: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  async function save(changes: Record<string, string>, reason: string, okText: (j: { versionId?: number }) => string) {
    setBusy(true); setMsg(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes, reason }) });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) { setMsg({ text: j.error ?? "Something went wrong.", bad: true }); return false; }
    setMsg({ text: okText(j), bad: false });
    router.refresh();
    return true;
  }
  return { busy, msg, save };
}

export function RulesForm({ current }: { current: Record<string, unknown> }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(RULE_FIELDS.map((f) => [f.key, show(current[f.key])])));
  const [reason, setReason] = useState("");
  const { busy, msg, save } = useSave("/api/settings/rules");
  const changed = RULE_FIELDS.filter((f) => vals[f.key] !== show(current[f.key]));
  const groups = [...new Set(RULE_FIELDS.map((f) => f.group))];
  return (
    <div className="card">
      {groups.map((g) => (
        <div key={g} style={{ marginBottom: 14 }}>
          <strong>{g}</strong>
          {RULE_FIELDS.filter((f) => f.group === g).map((f) => (
            <div key={f.key} className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
              <div style={{ flex: "1 1 320px" }}>
                <label htmlFor={`r-${f.key}`} style={{ margin: 0 }}>{RULE_LABELS[f.key]}</label>
                <div className="muted" style={{ fontSize: "0.85rem" }}>{f.help}</div>
              </div>
              {f.type === "mode" ? (
                <select id={`r-${f.key}`} value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}>
                  <option value="baseline">uplift the 12-week baseline</option><option value="weeks_check_only">uplift the weeks-of-stock check only</option>
                </select>
              ) : (
                <input id={`r-${f.key}`} type="text" value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} style={{ width: 150, borderColor: vals[f.key] !== show(current[f.key]) ? "var(--brand)" : undefined }} />
              )}
              {vals[f.key] !== show(current[f.key]) && <span className="muted">was {show(current[f.key])}</span>}
            </div>
          ))}
        </div>
      ))}
      <label htmlFor="rules-reason">Why are you changing {changed.length ? `${changed.length} rule${changed.length === 1 ? "" : "s"}` : "a rule"}? (saved with the new rule version)</label>
      <input id="rules-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", maxWidth: 560 }} placeholder="e.g. Agreed with procurement on 22 Oct" />
      <div className="actions">
        <button disabled={busy || !changed.length || !reason.trim()} onClick={async () => {
          const ok = await save(Object.fromEntries(changed.map((f) => [f.key, vals[f.key]])), reason, (j) => `Saved as rule version ${j.versionId}. It is used from the next run.`);
          if (ok) setReason("");
        }}>{busy ? "Saving…" : "Save as a new rule version"}</button>
        {changed.length > 0 && <button className="secondary" onClick={() => setVals(Object.fromEntries(RULE_FIELDS.map((f) => [f.key, show(current[f.key])])))}>Undo my edits</button>}
      </div>
      {msg && <p className={msg.bad ? "err" : "ok"} role="status" style={{ margin: "8px 0 0" }}>{msg.text}</p>}
    </div>
  );
}

export function ProjectForm({ current }: { current: Record<string, unknown> }) {
  const init = () => Object.fromEntries(PROJECT_FIELDS.map((f) => [f.key, f.type === "bool" ? String(current[f.key] === true) : show(current[f.key])]));
  const [vals, setVals] = useState<Record<string, string>>(init);
  const [reason, setReason] = useState("");
  const { busy, msg, save } = useSave("/api/settings/project");
  const orig = (f: (typeof PROJECT_FIELDS)[number]) => (f.type === "bool" ? String(current[f.key] === true) : show(current[f.key]));
  const changed = PROJECT_FIELDS.filter((f) => vals[f.key] !== orig(f));
  const groups = [...new Set(PROJECT_FIELDS.map((f) => f.group))];
  return (
    <div className="card">
      {groups.map((g) => (
        <div key={g} style={{ marginBottom: 14 }}>
          <strong>{g}</strong>
          {PROJECT_FIELDS.filter((f) => f.group === g).map((f) => (
            <div key={f.key} className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
              <div style={{ flex: "1 1 320px" }}><label htmlFor={`p-${f.key}`} style={{ margin: 0 }}>{f.label}</label><div className="muted" style={{ fontSize: "0.85rem" }}>{f.help}</div></div>
              {f.type === "bool" ? (
                <select id={`p-${f.key}`} value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}><option value="false">No</option><option value="true">Yes, confirmed</option></select>
              ) : (
                <input id={`p-${f.key}`} type={f.type === "date" ? "date" : "text"} value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} style={{ width: 160 }} />
              )}
              {vals[f.key] !== orig(f) && <span className="muted">was {orig(f) || "empty"}</span>}
            </div>
          ))}
        </div>
      ))}
      <label htmlFor="proj-reason">Why are you changing these? (saved in the change log)</label>
      <input id="proj-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", maxWidth: 560 }} />
      <div className="actions">
        <button disabled={busy || !changed.length || !reason.trim()} onClick={async () => {
          const ok = await save(Object.fromEntries(changed.map((f) => [f.key, vals[f.key]])), reason, () => "Saved and logged.");
          if (ok) setReason("");
        }}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {msg && <p className={msg.bad ? "err" : "ok"} role="status" style={{ margin: "8px 0 0" }}>{msg.text}</p>}
    </div>
  );
}

export function PauseCard({ paused, since, why }: { paused: boolean; since: string | null; why: string | null }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    const res = await fetch(paused ? "/api/system/resume" : "/api/system/pause", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    setBusy(false);
    if (!res.ok) return setError((await res.json()).error ?? "Something went wrong.");
    setReason(""); router.refresh();
  }
  return (
    <div className="card" id="pause" style={{ borderLeft: `6px solid var(${paused ? "--bad" : "--good"})` }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>{paused ? "The system is paused" : "The system is running"}</strong>
          {paused && <div className="muted">Paused {since ? new Date(since).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""} IST. Reason: {why}</div>}
        </div>
        <span className={`pill ${paused ? "bad" : "good"}`}>{paused ? "PAUSED" : "RUNNING"}</span>
      </div>
      <p className="muted">While paused: the Monday and Thursday run, Run now and the outcome check are blocked, every page shows a “System paused” banner, and existing flags stay visible. Pausing and resuming are logged with your reason. Only you do this: the system never pauses itself.</p>
      <label htmlFor="pause-reason">{paused ? "Why are you resuming?" : "Why are you pausing?"}</label>
      <input id="pause-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", maxWidth: 560 }} placeholder={paused ? "e.g. Data fixed and re-imported" : "e.g. K3 is red, reviewing the rules with Raghav"} />
      <div className="actions">
        <button className={paused ? "" : "danger"} onClick={go} disabled={busy || !reason.trim()}>{busy ? "Saving…" : paused ? "Resume system" : "Pause system"}</button>
      </div>
      {error && <p className="err" role="alert" style={{ margin: "8px 0 0" }}>{error}</p>}
    </div>
  );
}
