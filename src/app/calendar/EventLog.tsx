"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { EVENT_KINDS, KIND_LABELS, type EventKind } from "@/lib/season/events";

export interface EventRow { id: number; kind: EventKind; name: string; start_date: string; end_date: string; note: string | null; logged_by: string; effect: { ratio: number; weeks: number } | null }

const blank = { kind: "competitor_scheme" as EventKind, name: "", start_date: "", end_date: "", note: "" };
const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Form({ value, onChange, onSave, onCancel, busy, error, saveLabel }: { value: typeof blank; onChange: (v: typeof blank) => void; onSave: () => void; onCancel?: () => void; busy: boolean; error: string | null; saveLabel: string }) {
  const set = (k: keyof typeof blank, v: string) => onChange({ ...value, [k]: v });
  return (
    <div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div><label>Kind</label><select value={value.kind} onChange={(e) => set("kind", e.target.value)}>{EVENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}</select></div>
        <div style={{ flex: "1 1 220px" }}><label>Name</label><input type="text" value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Rival's Diwali bulk scheme" style={{ width: "100%" }} /></div>
        <div><label>Starts</label><input type="date" value={value.start_date} onChange={(e) => set("start_date", e.target.value)} /></div>
        <div><label>Ends</label><input type="date" value={value.end_date} onChange={(e) => set("end_date", e.target.value)} /></div>
      </div>
      <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 320px" }}><label>Note (optional)</label><input type="text" value={value.note} onChange={(e) => set("note", e.target.value)} placeholder="What happened, which markets, which products" style={{ width: "100%" }} /></div>
        <button onClick={onSave} disabled={busy}>{busy ? "Saving…" : saveLabel}</button>
        {onCancel && <button className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
      {error && <p className="err" role="alert" style={{ margin: "8px 0 0" }}>{error}</p>}
    </div>
  );
}

export default function EventLog({ events }: { events: EventRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(blank);
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true); setError(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Something went wrong."); return false; }
    router.refresh();
    return true;
  }

  return (
    <>
      <div className="card">
        <strong>Log an event</strong>
        <p className="muted" style={{ margin: "2px 0 10px" }}>Your own schemes, a competitor’s scheme, a festival that moved, a strike, anything unusual. Events are context for you and for the learning below. They never change a number or a flag.</p>
        <Form value={draft} onChange={setDraft} busy={busy && editId === null} error={editId === null ? error : null} saveLabel="Add event"
          onSave={async () => { if (await send("/api/calendar/events", "POST", draft)) setDraft(blank); }} />
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Event</th><th>Dates</th><th title="Weekly sales of all SKUs during the event, against the same weeks one year earlier (includes about a year of general growth)">Sales vs last year</th><th></th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                {editId === e.id ? (
                  <td colSpan={4}>
                    <Form value={edit} onChange={setEdit} busy={busy} error={error} saveLabel="Save changes" onCancel={() => { setEditId(null); setError(null); }}
                      onSave={async () => { if (await send(`/api/calendar/events/${e.id}`, "PATCH", edit)) setEditId(null); }} />
                  </td>
                ) : (
                  <>
                    <td>
                      <span className={`pill ${e.kind === "competitor_scheme" ? "bad" : e.kind === "own_scheme" ? "good" : e.kind === "festival" ? "warn" : ""}`}>{KIND_LABELS[e.kind]}</span>{" "}
                      <strong>{e.name}</strong>
                      {e.note && <div className="muted">{e.note}</div>}
                      <div className="muted" style={{ fontSize: "0.8rem" }}>logged by {e.logged_by}</div>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmt(e.start_date)}<br />to {fmt(e.end_date)}</td>
                    <td>{e.effect ? <><strong>{e.effect.ratio}x</strong><div className="muted">{e.effect.weeks} week{e.effect.weeks === 1 ? "" : "s"}</div></> : <span className="muted">not enough data</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="secondary" onClick={() => { setEditId(e.id); setEdit({ kind: e.kind, name: e.name, start_date: e.start_date, end_date: e.end_date, note: e.note ?? "" }); setError(null); }}>Edit</button>{" "}
                      <button className="danger" onClick={async () => { if (window.confirm(`Delete “${e.name}”? This cannot be undone.`)) await send(`/api/calendar/events/${e.id}`, "DELETE"); }}>Delete</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={4} className="muted">No events logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
