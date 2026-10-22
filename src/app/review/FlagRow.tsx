"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TAGS, TAG_LABELS, needsOwnDecision, type Tag } from "@/lib/review/decide";
import type { ReviewFlag } from "@/lib/review/data";

const LABEL: Record<string, string> = { high_demand: "High demand", stockout_risk: "Stockout risk", overstock_risk: "Overstock risk", needs_judgment: "Needs judgment" };
const TRIGGER: Record<string, [string, (f: ReviewFlag) => string]> = {
  short_history: ["New launch", (f) => `only ${f.numbers.history_weeks} weeks of sales history`],
  missing_weeks: ["Gaps in the data", (f) => `${f.numbers.missing_weeks} week${f.numbers.missing_weeks === 1 ? "" : "s"} of sales missing`],
  no_sales: ["No sales", () => "nothing sold in the last 12 weeks"],
  demand_surge: ["Sales jumped", (f) => `last ${f.numbers.recent_weeks} weeks are ${f.numbers.recent_vs_baseline}× the average`],
  demand_drop: ["Sales fell sharply", (f) => `last ${f.numbers.recent_weeks} weeks are ${f.numbers.recent_vs_baseline}× the average`],
};
const n0 = (x: number) => x.toLocaleString("en-IN");

/** What the signal column says for a standard flag, and how it is coloured. */
function signal(f: ReviewFlag): { main: string; sub: string; tone: "low" | "high" | "warn" } {
  const also = f.also_types.map((t) => LABEL[t].toLowerCase()).join(" and ");
  if (f.numbers.conflict) return { main: "Rules disagree", sub: "heavy overstock, but demand rising", tone: "high" };
  if (f.urgent) return { main: `Urgent · ${LABEL[f.flag_type]}`, sub: also ? `and ${also}` : "", tone: "low" };
  if (f.flag_type === "stockout_risk") return { main: LABEL.stockout_risk, sub: "below the minimum", tone: "low" };
  if (f.flag_type === "overstock_risk") return { main: LABEL.overstock_risk, sub: "above the maximum", tone: "high" };
  return { main: LABEL.high_demand, sub: also ? `and ${also}` : "sales above baseline", tone: "warn" };
}

export default function FlagRow({ flag: f, open, onToggle }: { flag: ReviewFlag; open: boolean; onToggle: () => void }) {
  const router = useRouter();
  const n = f.numbers;
  const own = needsOwnDecision(f);
  const judgment = f.flag_type === "needs_judgment";
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
    if (action === "override" && !tag) { setNeedTag(true); setError("Pick a reason tag first. Every override needs one."); if (!open) onToggle(); return; }
    if (tag === "other" && !text.trim()) { setError('Say what "Other" means in the box.'); if (!open) onToggle(); return; }
    setBusy(true);
    const body: Record<string, unknown> = { action, tag, text };
    if (action === "edit") body.qty = Number(qty);
    const res = await fetch(`/api/flags/${f.id}/decide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Something went wrong."); if (!open) onToggle(); return; }
    router.refresh();
  }

  async function rate(r: "up" | "down") {
    const next = rating === r ? null : r;
    setRating(next);
    await fetch(`/api/flags/${f.id}/rating`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: next }) });
  }

  const sig = judgment ? null : signal(f);
  const trig = judgment ? TRIGGER[n.triggers[0]] : null;
  const lowSide = f.flag_type !== "overstock_risk" || f.also_types.includes("stockout_risk");
  const limit = f.flag_type === "overstock_risk" ? n.max_weeks : n.min_weeks;
  const wos = n.weeks_of_stock;
  const fill = wos === null ? 0 : Math.min(100, (wos / (limit * 2)) * 100);
  const meterTone = f.flag_type === "overstock_risk" ? "high" : f.flag_type === "high_demand" && !f.also_types.includes("stockout_risk") ? "ok" : "";
  const would = n.context_flags.length ? n.context_flags.map((t) => LABEL[t]).join(" and ") : wos !== null ? `Stock covers ${wos} weeks` : "No stock figure";

  return (
    <div className="fr-item">
      {judgment || own ? (
        <div className="fr-row j">
          <div style={{ minWidth: 0 }}>
            <div className="fr-name">{f.name}</div>
            <div className="fr-sub">{f.sku_id} · {f.category}{f.is_perishable ? " · Perishable" : ""}</div>
          </div>
          <div>
            <span className="fr-lbl">Why the rules can’t decide</span>
            <div className="fr-sig judge">{trig ? trig[0] : "Rules disagree"}</div>
            <div className="fr-sub">{trig ? trig[1](f) : "heavy overstock, but demand is rising"}</div>
          </div>
          <div><span className="fr-lbl">The rules would otherwise say</span><div className="muted">{would}</div></div>
          <div className="fr-act">
            <button className="small" onClick={() => { if (!open) onToggle(); setEditing(true); }} disabled={busy}>Order a quantity…</button>
            <button className="small danger" onClick={() => send("override")} disabled={busy}>No order</button>
          </div>
        </div>
      ) : (
        <div className={`fr-row${f.urgent ? " urgent" : ""}`}>
          <div style={{ minWidth: 0 }}>
            <div className="fr-name">{f.name}</div>
            <div className="fr-sub">{f.sku_id} · {f.category}{f.is_perishable ? " · Perishable" : ""}</div>
          </div>
          <div>
            <span className="fr-lbl">Signal</span>
            <div className={`fr-sig ${sig!.tone}`}>{sig!.main}</div>
            <div className="fr-sub">{sig!.sub}</div>
          </div>
          <div>
            <span className="fr-lbl">Weeks of stock</span>
            {wos === null ? <span className="muted">n/a</span> : (
              <>
                <div><b>{wos} weeks</b><span className="muted"> · {lowSide && f.flag_type !== "overstock_risk" ? "min" : "max"} {limit}</span></div>
                <div className="meter"><i className={meterTone} style={{ width: `${fill}%` }} /><b /></div>
              </>
            )}
          </div>
          <div>
            <span className="fr-lbl">Recommended</span>
            <div style={{ fontWeight: 600 }}>{isPause ? "Pause order" : `${n0(f.recommended_qty!)} units`}</div>
            <div className="fr-sub">{isPause ? "no quantity" : f.flag_type === "high_demand" ? "1.5× standard order" : "the standard order"}</div>
          </div>
          <div className="fr-act">
            <button className="small" onClick={() => send("approve")} disabled={busy}>{isPause ? "Approve pause" : "Approve"}</button>
            <button className="ghost small chev" aria-label={open ? "Hide details" : "Show details"} aria-expanded={open} onClick={onToggle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="fr-detail">
          <dl>
            <div><dt>Stock on hand</dt><dd>{n0(n.stock)} units</dd></div>
            <div><dt>Weeks of stock</dt><dd>{wos ?? "n/a"}{n.season_factor !== 1 ? ` (with the ${Math.round((n.season_factor - 1) * 100)}% festival uplift)` : ""}</dd></div>
            <div><dt>Sales a week, last {n.recent_weeks} weeks</dt><dd>{n0(n.avg_recent)}</dd></div>
            <div><dt>Sales a week, last {n.baseline_weeks} weeks</dt><dd>{n0(n.avg_baseline)}</dd></div>
          </dl>
          <div className="col">
            <div>
              <div className="cap">Why it was flagged</div>
              <p style={{ margin: "4px 0 8px" }}>{f.reason}</p>
              <div className="reasonmeta" style={{ marginBottom: 0 }}>
                <span className={`source ${f.reason_source === "ai" ? "ai" : ""}`}>
                  <span className={`dot ${f.reason_source === "ai" ? "info" : ""}`} style={{ width: 6, height: 6 }} />
                  {f.reason_source === "ai" ? "AI-written" : f.reason_fallback === "not_yet" ? "Template, AI pending" : "Template"}
                </span>
                <span>·</span><span>Helpful?</span>
                <button className={`thumb ${rating === "up" ? "on" : ""}`} onClick={() => rate("up")} aria-pressed={rating === "up"}>Yes</button>
                <button className={`thumb ${rating === "down" ? "on" : ""}`} onClick={() => rate("down")} aria-pressed={rating === "down"}>No</button>
              </div>
            </div>
            <div>
              <div className="cap">Reason, optional (required to override)</div>
              <div className={`chips ${needTag && !tag ? "need" : ""}`} role="group" aria-label="Reason tag">
                {TAGS.map((t) => (
                  <button key={t} className={`chip ${tag === t ? "on" : ""}`} aria-pressed={tag === t} onClick={() => { setTag(tag === t ? null : t); setNeedTag(false); setError(null); }}>{TAG_LABELS[t]}</button>
                ))}
              </div>
              {tag === "other" && <input type="text" placeholder="What is the reason?" value={text} onChange={(e) => setText(e.target.value)} style={{ width: "100%", maxWidth: 420 }} />}
            </div>
            <div>
              {editing ? (
                <div className="edit">
                  <label htmlFor={`q${f.id}`} style={{ margin: 0 }}>Order</label>
                  <input id={`q${f.id}`} type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 130 }} autoFocus />
                  <span className="muted">units</span>
                  <button className="small" onClick={() => send("edit")} disabled={busy}>{own ? "Order this quantity" : "Save quantity and approve"}</button>
                  <button className="small secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
                </div>
              ) : (
                <div className="actions" style={{ marginTop: 0 }}>
                  {(!isPause || own) && <button className="small secondary" onClick={() => setEditing(true)} disabled={busy}>{own ? "Order a quantity…" : "Edit quantity"}</button>}
                  <button className="small danger" onClick={() => send("override")} disabled={busy}>{own ? "No order (override)" : "Override"}</button>
                </div>
              )}
            </div>
            {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
