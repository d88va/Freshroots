import { describe, expect, it } from "vitest";
import { evaluateK1, evaluateK2, evaluateK3, evaluateK4 } from "./criteria";

describe("K1: SAP export automated and clean by day 30", () => {
  const ok = { today: "2026-06-10", projectStart: "2026-05-26", day: 30, automatedConfirmed: true, importsClean: true, dataAgeDays: 3 };
  it("is green once all three checks pass", () => expect(evaluateK1(ok).status).toBe("green"));
  it("is amber while a check fails and days remain, saying how many", () => {
    const k = evaluateK1({ ...ok, automatedConfirmed: false });
    expect(k.status).toBe("amber");
    expect(k.detail.join(" ")).toContain("days left");
  });
  it("is red on day 30 if a check still fails", () => expect(evaluateK1({ ...ok, today: "2026-06-25", importsClean: false }).status).toBe("red"));
  it("is still amber on day 29", () => expect(evaluateK1({ ...ok, today: "2026-06-24", importsClean: false }).status).toBe("amber"));
  it("counts day 30 from the project start date setting", () => expect(evaluateK1({ ...ok, projectStart: "2026-06-01", today: "2026-06-25", automatedConfirmed: false }).status).toBe("amber"));
  it("treats no imports, or stale data, as a failed check", () => {
    expect(evaluateK1({ ...ok, importsClean: null, today: "2026-08-01" }).status).toBe("red");
    expect(evaluateK1({ ...ok, dataAgeDays: 40, today: "2026-08-01" }).status).toBe("red");
  });
  it("stays green after day 30 when everything passes", () => expect(evaluateK1({ ...ok, today: "2026-10-22" }).status).toBe("green"));
});

describe("K2: backtest catch rate", () => {
  const k = (caughtPct: number | null) => evaluateK2({ caughtPct, lift: 1.16, minPct: 50, amberMargin: 10, ranAt: "x" });
  it("is red under 50%", () => { expect(k(49.9).status).toBe("red"); expect(k(10).status).toBe("red"); });
  it("is amber from 50% up to 60%", () => { expect(k(50).status).toBe("amber"); expect(k(59.9).status).toBe("amber"); });
  it("is green from 60%", () => { expect(k(60).status).toBe("green"); expect(k(94.8).status).toBe("green"); });
  it("is grey before the backtest has run", () => expect(k(null).status).toBe("grey"));
  it("reports how much better than chance the rules are", () => expect(k(94.8).detail[0]).toContain("1.16x"));
  it("uses the thresholds from settings", () => expect(evaluateK2({ caughtPct: 55, lift: null, minPct: 60, amberMargin: 10, ranAt: null }).status).toBe("red"));
});

describe("K3: override rate from week 6 live", () => {
  const base = { goLive: "2026-07-20", today: "2026-10-22", afterWeeks: 6, threshold: 30, amber: 20 };
  it("is green below the warning level", () => expect(evaluateK3({ ...base, decided: 100, overridden: 15 }).status).toBe("green"));
  it("is amber above 20% up to 30%", () => { expect(evaluateK3({ ...base, decided: 100, overridden: 23 }).status).toBe("amber"); expect(evaluateK3({ ...base, decided: 100, overridden: 30 }).status).toBe("amber"); });
  it("is red only when MORE than 30% are overridden", () => { expect(evaluateK3({ ...base, decided: 100, overridden: 31 }).status).toBe("red"); expect(evaluateK3({ ...base, decided: 1000, overridden: 301 }).status).toBe("red"); });
  it("is not measured until six weeks after go-live", () => {
    const k = evaluateK3({ ...base, today: "2026-08-30", decided: 100, overridden: 90 });
    expect(k.status).toBe("grey");
    expect(k.current).toContain("2026-08-31");
  });
  it("starts counting exactly on day 42", () => {
    expect(evaluateK3({ ...base, today: "2026-08-30", decided: 100, overridden: 50 }).status).toBe("grey");
    expect(evaluateK3({ ...base, today: "2026-08-31", decided: 100, overridden: 50 }).status).toBe("red");
  });
  it("is grey with no go-live date or too few decisions", () => {
    expect(evaluateK3({ ...base, goLive: null, decided: 100, overridden: 90 }).status).toBe("grey");
    expect(evaluateK3({ ...base, decided: 5, overridden: 5 }).status).toBe("grey");
  });
  it("shows the rate and the counts", () => expect(evaluateK3({ ...base, decided: 411, overridden: 94 }).current).toContain("22.9% overridden (94 of 411"));
});

describe("K4: two quarters against the same dates last year", () => {
  const base = { goLive: "2026-07-20", quarters: 2, targetPct: 25 };
  it("shows 'not yet measurable' until two quarters of data exist", () => {
    const k = evaluateK4({ ...base, today: "2026-10-22", periods: [] });
    expect(k.status).toBe("grey");
    expect(k.current).toBe("Not yet measurable");
  });
  it("becomes measurable on day 182", () => {
    expect(evaluateK4({ ...base, today: "2027-01-17", periods: [{ measured: 1, lastYear: 1 }] }).status).toBe("grey");
    expect(evaluateK4({ ...base, today: "2027-01-18", periods: [{ measured: 1, lastYear: 1 }] }).status).not.toBe("grey");
  });
  const later = { ...base, today: "2027-02-01" };
  it("is red when losses are no better than last year", () => {
    expect(evaluateK4({ ...later, periods: [{ measured: 100, lastYear: 100 }, { measured: 110, lastYear: 100 }] }).status).toBe("red");
  });
  it("is amber when better but short of the 25% target", () => expect(evaluateK4({ ...later, periods: [{ measured: 90, lastYear: 100 }, { measured: 90, lastYear: 100 }] }).status).toBe("amber"));
  it("is green at the target", () => expect(evaluateK4({ ...later, periods: [{ measured: 75, lastYear: 100 }, { measured: 75, lastYear: 100 }] }).status).toBe("green"));
  it("is grey when there is nothing from last year to compare with", () => expect(evaluateK4({ ...later, periods: [{ measured: 90, lastYear: null }] }).status).toBe("grey"));
});
