"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TAGS, TAG_LABELS, needsOwnDecision, type Tag } from "@/lib/review/decide";
import type { ReviewFlag } from "@/lib/review/data";

const TYPE_LABEL: Record<string, string> = { high_demand: "High demand", stockout_risk: "Stockout risk", overstock_risk: "Overstock risk", needs_judgment: "Needs judgment" };
const TYPE_CLASS: Record<string, string> = { high_demand: "warn", stockout_risk: "bad", overstock_risk: "", needs_judgment: "info" };
const n0 = (x: number) => x.toLocaleString("en-IN");

export default function FlagCard({ flag: f }: { flag: ReviewFlag }) {
  const router = useRouter();
  const n = f.numbers;
  const own = needsOwnDecision(f);
  const isPause = f.recommended_qty === null && !own;
  const [tag, setTag] = useState<Tag | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(f.recommended_qty ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needTag, setNeedTag] = useState(false);
  const [rating, setRating] = useState(f.reason_rating);

  async function send(action: "approve" | "edit" | "override") {
    setError(null);
    if (action === "override" && !tag) { setNeedTag(true); setError("Pick a reason tag first. Every override needs one."); return; }
    if (tag === "other" && !text.trim()) { setError('Say what "Other" means in the box.'); return; }
    setBusy(true);
    const body: Record<string, unknown> = { action, tag, text };
    if (action === "edit") body.qty = Number(qty);
    const res = await fetch(`/api/flags/${f.id}/decide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setError((await res.json()).error ?? "Something went wrong.");
    router.refresh();
  }

  async function rate(r: "up" | "down") {
    const next = rating === r ? null : r;
    setRating(next);
    await fetch(`/api/flags/${f.id}/rating`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: next }) });
  }

  const wos = n.weeks_of_stock;
  const limit = f.flag_type === "overstock_risk" ? `max ${n.max_weeks}` : `min ${n.min_weeks}`;
  return (
    <div className={`flagcard ${f.urgent ? "urgent" : f.flag_type}`}>
      <div className="head">
        <h3>{f.name}</h3>
        <span className="muted">{f.sku_id} · {f.category}</span>
        {f.urgent && <span className="pill bad">URGENT</span>}
        <span className={`pill ${TYPE_CLASS[f.flag_type]}`}>{TYPE_LABEL[f.flag_type]}</span>
        {f.also_types.map((t) => <span key={t} className={`pill ${TYPE_CLASS[t]}`}>{TYPE_LABEL[t]}</span>)}
        {f.is_perishable && <span className="pill">Perishable</span>}
        {n.conflict && <span className="pill info">Rules disagree</span>}
      </div>

      <div className="stats">
        <div className="stat"><div className="k">Stock on hand</div><div className="v">{n0(n.stock)} units</div></div>
        <div className="stat"><div className="k">Weeks of stock ({limit}{n.season_factor !== 1 ? `, +${Math.round((n.season_factor - 1) * 100)}% festival` : ""})</div><div className="v">{wos ?? "n/a"}</div></div>
        <div className="stat"><div className="k">Sales / week, last {n.recent_weeks} wks</div><div className="v">{n0(n.avg_recent)}</div></div>
        <div className="stat"><div className="k">Sales / week, last {n.baseline_weeks} wks</div><div className="v">{n0(n.avg_baseline)}</div></div>
        <div className="stat"><div className="k">{f.recommended_qty === null ? "Recommendation" : "Recommended order"}</div><div className="v">{f.recommended_qty === null ? (own ? "none (your call)" : "pause next order") : `${n0(f.recommended_qty)} units`}</div></div>
      </div>

      <div className="reason">{f.reason}</div>
      <div className="reasonmeta">
        <span className={`pill ${f.reason_source === "ai" ? "info" : ""}`} title={f.reason_source === "template" && f.reason_fallback ? `Template used: ${f.reason_fallback.replace("_", " ")}` : undefined}>
          {f.reason_source === "ai" ? "AI-written" : f.reason_fallback === "not_yet" ? "Template (AI pending)" : "Template"}
        </span>
        <span>Was this reason helpful?</span>
        <button className={`thumb ${rating === "up" ? "on" : ""}`} onClick={() => rate("up")} aria-label="Thumbs up" aria-pressed={rating === "up"}>👍</button>
        <button className={`thumb ${rating === "down" ? "on" : ""}`} onClick={() => rate("down")} aria-label="Thumbs down" aria-pressed={rating === "down"}>👎</button>
      </div>

      <div className={`chips ${needTag && !tag ? "need" : ""}`} role="group" aria-label="Reason tag">
        <span className="lbl">Why? (optional, required to override)</span>
        {TAGS.map((t) => (
          <button key={t} className={`chip ${tag === t ? "on" : ""}`} aria-pressed={tag === t} onClick={() => { setTag(tag === t ? null : t); setNeedTag(false); setError(null); }}>{TAG_LABELS[t]}</button>
        ))}
      </div>
      {tag === "other" && <input type="text" placeholder="What is the reason?" value={text} onChange={(e) => setText(e.target.value)} style={{ width: "100%", maxWidth: 420, marginBottom: 6 }} />}

      <div className="actions">
        {editing ? (
          <>
            <label style={{ margin: 0, fontWeight: 500 }} htmlFor={`q${f.id}`}>Order</label>
            <input id={`q${f.id}`} type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 130 }} autoFocus />
            <span className="muted">units</span>
            <button onClick={() => send("edit")} disabled={busy}>{own ? "Order this quantity" : "Save quantity and approve"}</button>
            <button className="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          </>
        ) : (
          <>
            {!own && <button onClick={() => send("approve")} disabled={busy}>{isPause ? "Approve pause" : `Approve ${n0(f.recommended_qty!)} units`}</button>}
            {(own || !isPause) && <button className={own ? "" : "secondary"} onClick={() => setEditing(true)} disabled={busy}>{own ? "Order a quantity…" : "Edit quantity"}</button>}
            <button className="danger" onClick={() => send("override")} disabled={busy}>{own ? "No order (override)" : "Override"}</button>
          </>
        )}
      </div>
      {error && <p className="err" style={{ margin: "8px 0 0" }} role="alert">{error}</p>}
    </div>
  );
}
