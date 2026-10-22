"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RULE_LABELS } from "@/lib/rules/settings";

export interface SuggestionView {
  id: number; kind: "override_rate" | "tag"; title: string; text: string; rule_key: string;
  evidence: { overrides?: number; rate?: number; tags?: Record<string, number>; checked?: number; raghav_right?: number; raghav_wrong?: number; decisions?: number; rules?: Record<string, number> };
  proposal: { key: string; from: unknown; to: unknown; what_if?: { overrides_stopped: number; overrides_total: number; approved_lost: number; approved_total: number } } | null;
}

const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));
const TAGS: Record<string, string> = { season_missed: "Season missed", new_launch: "New launch", competitor_scheme: "Competitor scheme", data_wrong: "Data is wrong", other: "Other", none: "No tag" };

export default function SuggestionCard({ s, current }: { s: SuggestionView; current: Record<string, unknown> }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "accept" | "edit" | "dismiss">(null);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(s.proposal?.key ?? (s.rule_key in RULE_LABELS ? s.rule_key : "stockout_weeks"));
  const [value, setValue] = useState(s.proposal ? show(s.proposal.to) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "accept" | "edit" | "dismiss") {
    setBusy(true); setError(null);
    const body = action === "edit" ? { key, value, reason } : { reason };
    const res = await fetch(`/api/suggestions/${s.id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setError((await res.json()).error ?? "Something went wrong.");
    router.refresh();
  }

  const w = s.proposal?.what_if;
  const stoppedShare = w ? w.overrides_stopped / w.overrides_total : 0;
  const lostShare = w && w.approved_total ? w.approved_lost / w.approved_total : 0;
  const clear = w ? lostShare === 0 || stoppedShare / lostShare >= 1.5 : false;
  const ev = s.evidence;

  return (
    <div className="flagcard">
      <div className="head">
        <h3>{s.title}</h3>
        <span className={`pill ${s.kind === "override_rate" ? "warn" : "info"}`}>{s.kind === "override_rate" ? "Rule overridden often" : "Reason keeps recurring"}</span>
      </div>
      <p style={{ margin: "0 0 8px" }}>{s.text}</p>
      <div className="pills" style={{ marginBottom: 8 }}>
        {ev.overrides !== undefined && <span className="pill">{ev.overrides} overrides{ev.rate !== undefined ? ` (${ev.rate}%)` : ""}</span>}
        {ev.tags && Object.entries(ev.tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => <span key={t} className="pill">{TAGS[t] ?? t}: {n}</span>)}
        {ev.rules && Object.entries(ev.rules).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => <span key={t} className="pill">{t}: {n}</span>)}
        {ev.checked ? <span className="pill good">Raghav was right on {ev.raghav_right} of {ev.checked} checked overrides ({Math.round(((ev.raghav_right ?? 0) / ev.checked) * 100)}%)</span> : null}
      </div>

      {s.proposal && (
        <div className="card" style={{ background: "var(--bg)", marginBottom: 8 }}>
          <div><strong>Proposed change:</strong> {RULE_LABELS[s.proposal.key] ?? s.proposal.key} <strong>{show(s.proposal.from)} → {show(s.proposal.to)}</strong></div>
          {w && (
            <div className="muted" style={{ marginTop: 4 }}>
              Looking back, it would have stopped {w.overrides_stopped} of {w.overrides_total} flags you overrode ({Math.round(stoppedShare * 100)}%) and {w.approved_lost} of {w.approved_total} you kept ({Math.round(lostShare * 100)}%).{" "}
              <strong className={clear ? "ok" : "err"}>{clear ? "A clear trade-off." : "A weak trade-off: it would also stop a similar share of the flags you kept."}</strong>
            </div>
          )}
          {s.kind === "tag" && <div className="muted" style={{ marginTop: 4 }}>This adds the whole month to the season months, for every category. Check the Season calendar page first.</div>}
        </div>
      )}

      {mode === null ? (
        <div className="actions">
          {s.proposal && <button onClick={() => setMode("accept")}>Accept this change…</button>}
          <button className="secondary" onClick={() => setMode("edit")}>Edit…</button>
          <button className="secondary" onClick={() => setMode("dismiss")}>Dismiss…</button>
        </div>
      ) : (
        <div>
          {mode === "edit" && (
            <div className="row" style={{ margin: "0 0 8px", alignItems: "flex-end" }}>
              <div><label>Setting</label>
                <select value={key} onChange={(e) => { setKey(e.target.value); setValue(""); }}>{Object.entries(RULE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div><label>New value (now {show(current[key])})</label><input type="text" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 150 }} placeholder={key === "season_months" ? "e.g. 3, 9, 10, 11" : ""} /></div>
            </div>
          )}
          <label htmlFor={`r${s.id}`}>{mode === "dismiss" ? "Why dismiss? (optional)" : "Your reason (saved with the new rule version)"}</label>
          <input id={`r${s.id}`} type="text" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", maxWidth: 560 }} autoFocus
            placeholder={mode === "dismiss" ? "e.g. one-off, not a pattern" : "e.g. Ganesh Chaturthi demand starts in August"} />
          <div className="actions">
            <button onClick={() => send(mode)} disabled={busy || (mode !== "dismiss" && !reason.trim())}>
              {busy ? "Saving…" : mode === "accept" ? "Save as a new rule version" : mode === "edit" ? "Save my value as a new rule version" : "Dismiss"}
            </button>
            <button className="secondary" onClick={() => { setMode(null); setError(null); }} disabled={busy}>Cancel</button>
          </div>
          {mode !== "dismiss" && <p className="muted" style={{ margin: "6px 0 0" }}>Used from the next run. Nothing changes until you save.</p>}
        </div>
      )}
      {error && <p className="err" role="alert" style={{ margin: "8px 0 0" }}>{error}</p>}
    </div>
  );
}
