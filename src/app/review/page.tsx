import Link from "next/link";
import { getSql } from "@/lib/db/client";
import { needsOwnDecision } from "@/lib/review/decide";
import { pendingFlags } from "@/lib/review/data";
import ApproveAll from "./ApproveAll";
import FlagCard from "./FlagCard";

export const dynamic = "force-dynamic";

export default async function Review() {
  const flags = await pendingFlags(getSql());
  const standard = flags.filter((f) => !needsOwnDecision(f));
  const own = flags.filter(needsOwnDecision);
  const urgent = standard.filter((f) => f.urgent).length;
  const reorders = standard.filter((f) => f.recommended_qty !== null);
  const bulk = {
    ids: standard.map((f) => f.id),
    reorders: reorders.length,
    units: reorders.reduce((a, f) => a + (f.recommended_qty ?? 0), 0),
    pauses: standard.length - reorders.length,
    judgment: own.length,
  };
  const aiPending = flags.filter((f) => f.reason_fallback === "not_yet").length;

  return (
    <>
      <h1>Review flags</h1>
      <p className="lead">Nothing is ordered until you approve it. Approve, edit the quantity, or override with a reason.</p>

      <div className="pills">
        <span className="pill">{flags.length} pending</span>
        {urgent > 0 && <span className="pill bad">{urgent} urgent</span>}
        <span className="pill info">{own.length} need your judgment</span>
        {aiPending > 0 && <span className="pill warn">{aiPending} reasons still being written</span>}
      </div>

      {flags.length === 0 && (
        <div className="card empty">
          <strong>Nothing to review.</strong>
          <p>Flags appear after a run. See <Link href="/orders">Orders</Link> for what you have approved.</p>
        </div>
      )}

      {standard.length > 0 && (
        <>
          <div className="sectionhead">
            <h2>Flags to review ({standard.length})</h2>
            <ApproveAll s={bulk} />
          </div>
          <p className="muted" style={{ marginTop: 0 }}>Most urgent first. “Approve all” never includes the judgment cases below.</p>
          {standard.map((f) => <FlagCard key={f.id} flag={f} />)}
        </>
      )}

      {own.length > 0 && (
        <>
          <div className="sectionhead"><h2>Needs your judgment ({own.length})</h2></div>
          <p className="muted" style={{ marginTop: 0 }}>New launches, gaps in the data, unusual swings, or flags where the rules disagree. The system recommends no quantity. Decide one at a time.</p>
          {own.map((f) => <FlagCard key={f.id} flag={f} />)}
        </>
      )}
    </>
  );
}
