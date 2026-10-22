import { getSql } from "@/lib/db/client";
import { needsOwnDecision } from "@/lib/review/decide";
import { pendingFlags } from "@/lib/review/data";
import ApproveAll from "./ApproveAll";
import ReviewList from "./ReviewList";

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
  const waiting = flags.filter((f) => f.reason_fallback === "not_yet").length;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1>Review</h1>
          <p className="lead" style={{ margin: "4px 0 0" }}>
            {flags.length} flag{flags.length === 1 ? "" : "s"} to decide{urgent ? `, ${urgent} urgent` : ""}. Nothing is ordered until you approve it.
            {waiting ? ` ${waiting} reasons are still template text while the AI catches up.` : ""}
          </p>
        </div>
        <ApproveAll s={bulk} />
      </div>
      <ReviewList standard={standard} own={own} />
    </>
  );
}
