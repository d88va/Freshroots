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
    <div className="panel" style={{ overflow: "visible" }}>
      {groups.map((g) => (
        <div key={g}>
          <div className="sgroup">{g}</div>
          {RULE_FIELDS.filter((f) => f.group === g).map((f) => (
            <div key={f.key} className="srow">
              <div>
                <label htmlFor={`r-${f.key}`} style={{ margin: 0, fontSize: 14 }}>{RULE_LABELS[f.key]}</label>
                <div className="muted" style={{ fontSize: 13 }}>{f.help}{vals[f.key] !== show(current[f.key]) ? ` Was ${show(current[f.key])}.` : ""}</div>
              </div>
              {f.type === "mode" ? (
                <select id={`r-${f.key}`} value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}>
                  <option value="baseline">uplift the 12-week baseline</option><option value="weeks_check_only">uplift the weeks-of-stock check only</option>
                </select>
              ) : (
                <input id={`r-${f.key}`} type="text" value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} style={vals[f.key] !== show(current[f.key]) ? { borderColor: "var(--brand)" } : undefined} />
              )}
            </div>
          ))}
        </div>
      ))}
      <div className="sfoot">
        <label htmlFor="rules-reason">Why are you changing {changed.length ? `${changed.length} rule${changed.length === 1 ? "" : "s"}` : "a rule"}? Saved with the new version.</label>
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
    <div className="panel" style={{ overflow: "visible" }}>
      {groups.map((g) => (
        <div key={g}>
          <div className="sgroup">{g}</div>
          {PROJECT_FIELDS.filter((f) => f.group === g).map((f) => (
            <div key={f.key} className="srow">
              <div><label htmlFor={`p-${f.key}`} style={{ margin: 0, fontSize: 14 }}>{f.label}</label><div className="muted" style={{ fontSize: 13 }}>{f.help}{vals[f.key] !== orig(f) ? ` Was ${orig(f) || "empty"}.` : ""}</div></div>
              {f.type === "bool" ? (
                <select id={`p-${f.key}`} value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}><option value="false">No</option><option value="true">Yes, confirmed</option></select>
              ) : (
                <input id={`p-${f.key}`} type={f.type === "date" ? "date" : "text"} value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
              )}
            </div>
          ))}
        </div>
      ))}
      <div className="sfoot">
        <label htmlFor="proj-reason">Why are you changing these? Saved in the change log.</label>
        <input id="proj-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", maxWidth: 560 }} />
        <div className="actions">
          <button disabled={busy || !changed.length || !reason.trim()} onClick={async () => {
            const ok = await save(Object.fromEntries(changed.map((f) => [f.key, vals[f.key]])), reason, () => "Saved and logged.");
            if (ok) setReason("");
          }}>{busy ? "Saving…" : "Save"}</button>
        </div>
        {msg && <p className={msg.bad ? "err" : "ok"} role="status" style={{ margin: "8px 0 0" }}>{msg.text}</p>}
      </div>
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
    <div className="card" id="pause" style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start", justifyContent: "space-between", padding: 24 }}>
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <div className="row" style={{ gap: 10 }}>
          <strong style={{ fontSize: 16, lineHeight: "24px" }}>{paused ? "The system is paused" : "The system is running"}</strong>
          <span className={`pill ${paused ? "bad" : "good"}`}>{paused ? "PAUSED" : "RUNNING"}</span>
        </div>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          {paused ? `Since ${since ? new Date(since).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""} IST. Reason: ${why}. ` : ""}
          While paused, the Monday and Thursday run, Run now and the outcome check are blocked, every page shows a banner, and existing flags stay visible. Only you pause or resume. The system never does it by itself.
        </p>
      </div>
      <div style={{ flex: "1 1 320px", maxWidth: 420 }}>
        <label htmlFor="pause-reason">{paused ? "Why are you resuming?" : "Why are you pausing?"}</label>
        <input id="pause-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%" }} placeholder={paused ? "e.g. Data fixed and re-imported" : "e.g. K3 is red, reviewing the rules with Raghav"} />
        <div className="actions">
          <button className={paused ? "" : "danger secondary"} onClick={go} disabled={busy || !reason.trim()}>{busy ? "Saving…" : paused ? "Resume system" : "Pause system"}</button>
        </div>
        {error && <p className="err" role="alert" style={{ margin: "8px 0 0" }}>{error}</p>}
      </div>
    </div>
  );
}
