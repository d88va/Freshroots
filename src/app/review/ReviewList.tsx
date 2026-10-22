"use client";
import { useState } from "react";
import type { ReviewFlag } from "@/lib/review/data";
import FlagRow from "./FlagRow";

const SHOW = 20;

export default function ReviewList({ standard, own }: { standard: ReviewFlag[]; own: ReviewFlag[] }) {
  const [tab, setTab] = useState<"review" | "judgment">(standard.length || !own.length ? "review" : "judgment");
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? standard : standard.slice(0, SHOW);
  const toggle = (id: number) => setOpen(open === id ? null : id);

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Flag lists">
        <button role="tab" aria-selected={tab === "review"} className={`tab${tab === "review" ? " active" : ""}`} onClick={() => setTab("review")}>To review<span className="n">{standard.length}</span></button>
        <button role="tab" aria-selected={tab === "judgment"} className={`tab${tab === "judgment" ? " active" : ""}`} onClick={() => setTab("judgment")}>Needs your judgment<span className="n">{own.length}</span></button>
      </div>

      {tab === "review" && (
        <div className="fr">
          {standard.length === 0 ? <div className="empty">Nothing to review. New flags appear after the next run.</div> : (
            <>
              <div className="fr-cols"><span>Product</span><span>Signal</span><span>Weeks of stock</span><span>Recommended</span><span /></div>
              {shown.map((f) => <FlagRow key={f.id} flag={f} open={open === f.id} onToggle={() => toggle(f.id)} />)}
              <div className="fr-foot">
                <span>Showing {shown.length} of {standard.length} flags, most urgent first</span>
                {standard.length > SHOW && <button className="ghost small" onClick={() => setAll(!all)}>{all ? "Show fewer" : "Show all"}</button>}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "judgment" && (
        <>
          <p className="muted" style={{ margin: "16px 0 0", maxWidth: 640 }}>New launches, gaps in the data and unusual swings. The system recommends no quantity, and these are never included in “Approve all”. Decide one at a time.</p>
          <div className="fr" style={{ marginTop: 12 }}>
            {own.length === 0 ? <div className="empty">Nothing needs your judgment right now.</div> : (
              <>
                <div className="fr-cols j"><span>Product</span><span>Why the rules can’t decide</span><span>The rules would otherwise say</span><span /></div>
                {own.map((f) => <FlagRow key={f.id} flag={f} open={open === f.id} onToggle={() => toggle(f.id)} />)}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
