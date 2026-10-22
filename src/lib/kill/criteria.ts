// The kill criteria (K1 to K4) from the pre-build map. They only ever SHOW status. Nothing here stops, pauses or changes anything:
// stopping the build is the owner's decision. Every threshold comes from settings. Pure functions, no database.

export type Status = "green" | "amber" | "red" | "grey";
export interface Criterion {
  id: "K1" | "K2" | "K3" | "K4";
  title: string;
  where: string;
  status: Status;
  current: string;   // the current value, in words
  threshold: string; // the stop line, in words
  detail: string[];  // the checks behind the status
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---------- K1: by day 30, the SAP export is automated and clean ----------
export interface K1Input { today: string; projectStart: string; day: number; automatedConfirmed: boolean; importsClean: boolean | null; dataAgeDays: number | null; maxDataAgeDays?: number }
export function evaluateK1(i: K1Input): Criterion {
  const elapsed = daysBetween(i.projectStart, i.today);
  const fresh = i.dataAgeDays !== null && i.dataAgeDays <= (i.maxDataAgeDays ?? 14);
  const clean = i.importsClean === true;
  const satisfied = i.automatedConfirmed && clean && fresh;
  const status: Status = satisfied ? "green" : elapsed >= i.day ? "red" : "amber";
  return {
    id: "K1", title: "SAP export automated and clean", where: "Import page", status,
    current: `Day ${elapsed} of ${i.day}`,
    threshold: `Automated and clean by day ${i.day}`,
    detail: [
      `${i.automatedConfirmed ? "Yes" : "No"}: the owner has confirmed a scheduled SAP export is running`,
      `${i.importsClean === null ? "No" : clean ? "Yes" : "No"}: the latest sales, stock and SKU imports had no rejected rows`,
      `${fresh ? "Yes" : "No"}: the newest sales week is ${i.dataAgeDays === null ? "unknown" : `${i.dataAgeDays} days old`} (fresh means ${i.maxDataAgeDays ?? 14} days or less)`,
      satisfied ? "All three checks pass." : elapsed >= i.day ? "Day limit passed with a check failing: this is the stop signal." : `${i.day - elapsed} days left to get all three checks passing.`,
    ],
  };
}

// ---------- K2: the backtest ----------
export interface K2Input { caughtPct: number | null; lift: number | null; minPct: number; amberMargin: number; ranAt: string | null }
export function evaluateK2(i: K2Input): Criterion {
  if (i.caughtPct === null) return { id: "K2", title: "Rules would have caught past losses", where: "Rules engine (Backtest)", status: "grey", current: "Not run yet", threshold: `Under ${i.minPct}% caught = stop`, detail: ["Run the backtest on the Backtest page."] };
  const status: Status = i.caughtPct < i.minPct ? "red" : i.caughtPct < i.minPct + i.amberMargin ? "amber" : "green";
  return {
    id: "K2", title: "Rules would have caught past losses", where: "Rules engine (Backtest)", status,
    current: `${i.caughtPct}% of past stockouts and write-offs flagged before they happened`,
    threshold: `Under ${i.minPct}% = stop and re-document the rules with Raghav`,
    detail: [
      i.lift !== null ? `The rules are ${i.lift}x better than random flagging. Read the headline next to this number.` : "No chance baseline in this backtest.",
      status === "amber" ? `Within ${i.amberMargin} points of the stop line.` : status === "red" ? "Below the stop line." : "Comfortably above the stop line.",
    ],
  };
}

// ---------- K3: Raghav's override rate, from week 6 live ----------
export interface K3Input { goLive: string | null; today: string; afterWeeks: number; decided: number; overridden: number; threshold: number; amber: number; minSample?: number }
export function evaluateK3(i: K3Input): Criterion {
  const base = { id: "K3" as const, title: "Raghav trusts the flags", where: "Review screen", threshold: `More than ${i.threshold}% overridden = pause` };
  if (!i.goLive) return { ...base, status: "grey", current: "No go-live date set", detail: ["Set the go-live date on the Settings page. K3 is measured from week " + i.afterWeeks + " live."] };
  const start = addDays(i.goLive, i.afterWeeks * 7);
  if (i.today < start) return { ...base, status: "grey", current: `Not yet measured (starts ${start})`, detail: [`K3 only counts decisions from ${i.afterWeeks} weeks after go-live (${i.goLive}).`] };
  const min = i.minSample ?? 20;
  if (i.decided < min) return { ...base, status: "grey", current: `Only ${i.decided} decisions so far`, detail: [`At least ${min} decisions are needed before the rate means anything.`] };
  const rate = r1((i.overridden / i.decided) * 100);
  const status: Status = rate > i.threshold ? "red" : rate > i.amber ? "amber" : "green";
  return {
    ...base, status, current: `${rate}% overridden (${i.overridden} of ${i.decided} decisions since ${start})`,
    detail: [
      status === "red" ? "Above the pause line. The system suggests a pause but never pauses itself." : status === "amber" ? `Above ${i.amber}%: worth looking at the Feedback page.` : "Below the warning level.",
    ],
  };
}

// ---------- K4: two quarters of real results against last year ----------
export interface K4Input { goLive: string | null; today: string; quarters: number; periods: { measured: number; lastYear: number | null }[]; targetPct: number; periodDays?: number }
export function evaluateK4(i: K4Input): Criterion {
  const days = i.periodDays ?? 91;
  const base = { id: "K4" as const, title: "Losses are lower than before", where: "Feedback summary", threshold: `Stockout and write-off ₹ no better than the baseline after ${i.quarters} quarters = stop` };
  if (!i.goLive) return { ...base, status: "grey", current: "No go-live date set", detail: ["Set the go-live date on the Settings page."] };
  const elapsed = daysBetween(i.goLive, i.today);
  if (elapsed < days * i.quarters) return { ...base, status: "grey", current: "Not yet measurable", detail: [`Needs ${i.quarters} full quarters of live data. Day ${Math.max(0, elapsed)} of ${days * i.quarters}.`, "Each live quarter is compared with the same dates one year earlier, so festival months are fairly compared."] };
  const usable = i.periods.filter((p) => p.lastYear !== null && p.lastYear > 0);
  if (!usable.length) return { ...base, status: "grey", current: "No year-earlier data to compare with", detail: ["Load at least a year of loss history from before go-live."] };
  const measured = usable.reduce((a, p) => a + p.measured, 0), before = usable.reduce((a, p) => a + (p.lastYear as number), 0);
  const change = r1(((measured - before) / before) * 100);
  const status: Status = change >= 0 ? "red" : -change < i.targetPct ? "amber" : "green";
  return {
    ...base, status, current: `${change > 0 ? "+" : ""}${change}% against the same dates last year`,
    detail: [status === "red" ? "No better than the baseline: this is the stop signal." : status === "amber" ? `Better than the baseline, but short of the ${i.targetPct}% target.` : `At or above the ${i.targetPct}% target.`],
  };
}
