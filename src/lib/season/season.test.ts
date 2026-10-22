import { describe, expect, it } from "vitest";
import { addDays } from "../rules/dates";
import { activeFactors, eventEffect, findGaps, monthlyIndex, type WeeklyPoint } from "./learn";
import { validateEvent } from "./events";

const START = "2023-01-02"; // a Monday
/** Four years of weekly sales: 5% yearly growth, a march uplift of 50%, and nothing else. */
function series(weeks: number, uplift: (month: number) => number, growth = 0.05): WeeklyPoint[] {
  return Array.from({ length: weeks }, (_, i) => {
    const week = addDays(START, 7 * i);
    return { week, units: 1000 * (1 + (growth * i) / 52) * uplift(Number(week.slice(5, 7))) };
  });
}

describe("monthlyIndex", () => {
  const idx = monthlyIndex(series(208, (m) => (m === 3 ? 1.5 : 1)));
  it("finds the month that runs high", () => expect(idx[2].index!).toBeGreaterThan(1.3));
  it("reports ordinary months at or a little below 1 (the high month pulls the average up)", () => {
    for (const m of [0, 5, 8]) { expect(idx[m].index!).toBeGreaterThan(0.85); expect(idx[m].index!).toBeLessThan(1.05); }
  });
  it("is not fooled by steady growth: a series that only grows has an index near 1 in every month", () => {
    const flat = monthlyIndex(series(208, () => 1, 0.2));
    for (const m of flat) expect(m.index!).toBeGreaterThan(0.97), expect(m.index!).toBeLessThan(1.03);
  });
  it("needs a full 53-week window around a week, so the first and last half-year are not used", () => {
    const short = monthlyIndex(series(60, () => 1));
    expect(short.every((m) => m.index === null)).toBe(true);
  });
  it("says how much evidence stands behind each month", () => {
    expect(idx[2].weeks).toBeGreaterThanOrEqual(6);
    expect(idx[2].years).toBeGreaterThanOrEqual(2);
  });
  it("skips months with too few weeks instead of guessing", () => {
    const s = series(80, () => 1); // only 27 weeks have a full window
    const r = monthlyIndex(s);
    expect(r.filter((m) => m.index !== null).length).toBeLessThan(12);
  });
});

describe("active factors and gaps", () => {
  const active = activeFactors([10, 11, 3], 1.25);
  it("is 1.25 in October, November and March and 1 elsewhere", () => {
    expect(active[9]).toBe(1.25); expect(active[10]).toBe(1.25); expect(active[2]).toBe(1.25);
    expect(active.filter((f) => f === 1).length).toBe(9);
  });
  const month = (m: number, index: number | null) => ({ month: m, index, weeks: 8, years: 2 });
  const cats = {
    Beverages: [month(1, 1.0), month(5, 1.22), month(10, 1.24)],
    Oils: [month(3, 0.95), month(7, null)],
  };
  it("reports only months that differ by at least the threshold, biggest first", () => {
    const g = findGaps(cats, active, 0.15);
    expect(g.map((c) => `${c.category}-${c.month}`)).toEqual(["Oils-3", "Beverages-5"]);
    expect(g.find((c) => c.category === "Beverages" && c.month === 5)).toMatchObject({ direction: "above", gap: 0.22 });
    expect(g.find((c) => c.category === "Oils" && c.month === 3)).toMatchObject({ direction: "below", gap: -0.3 });
  });
  it("ignores small differences and months without data", () => {
    const g = findGaps(cats, active, 0.15);
    expect(g.some((c) => c.month === 1 || c.month === 10 || c.month === 7)).toBe(false);
  });
  it("sorts by the size of the gap", () => {
    const g = findGaps(cats, active, 0.15);
    expect(Math.abs(g[0].gap)).toBeGreaterThanOrEqual(Math.abs(g[1].gap));
  });
  it("a bigger threshold shows fewer cards", () => expect(findGaps(cats, active, 0.25).length).toBe(1));
});

describe("eventEffect", () => {
  // Two years of weekly sales: every week 1000 last year; this year 1000 except 3 weeks (a scheme) at 1500
  const totals = new Map<string, number>();
  for (let i = 0; i < 110; i++) totals.set(addDays("2024-01-01", 7 * i), i >= 52 + 20 && i < 52 + 23 ? 1500 : 1000);
  const start = addDays("2024-01-01", 7 * 72);
  it("compares sales during an event with the same weeks a year earlier", () => {
    expect(eventEffect(totals, start, addDays(start, 20))).toEqual({ ratio: 1.5, weeks: 3 });
  });
  it("a festival that happens every year shows as 1x, not as an effect", () => {
    const festival = new Map<string, number>();
    for (let i = 0; i < 110; i++) festival.set(addDays("2024-01-01", 7 * i), [20, 21, 72, 73].includes(i) ? 1800 : 1000);
    expect(eventEffect(festival, addDays("2024-01-01", 7 * 72), addDays("2024-01-01", 7 * 73))).toEqual({ ratio: 1, weeks: 2 });
  });
  it("returns null for a future event or one without last year's data", () => {
    expect(eventEffect(totals, "2030-01-07", "2030-01-20")).toBeNull();
    expect(eventEffect(totals, "2024-02-05", "2024-02-12")).toBeNull();
  });
  it("uses only the weeks it has data for on both sides", () => {
    expect(eventEffect(totals, addDays("2024-01-01", 7 * 107), addDays("2024-01-01", 7 * 120))!.weeks).toBe(3);
  });
});

describe("validateEvent", () => {
  const ok = { kind: "competitor_scheme", name: " Rival Diwali scheme ", start_date: "2026-10-01", end_date: "2026-10-20", note: "  " };
  it("accepts a good event and tidies it", () => expect(validateEvent(ok)).toEqual({ ok: true, value: { kind: "competitor_scheme", name: "Rival Diwali scheme", start_date: "2026-10-01", end_date: "2026-10-20", note: null } }));
  it("accepts a one-day event", () => expect(validateEvent({ ...ok, end_date: "2026-10-01" }).ok).toBe(true));
  it("rejects a missing name, a bad kind, bad or reversed dates", () => {
    expect(validateEvent({ ...ok, name: "  " }).ok).toBe(false);
    expect(validateEvent({ ...ok, kind: "party" }).ok).toBe(false);
    expect(validateEvent({ ...ok, start_date: "2026-02-30" }).ok).toBe(false);
    expect(validateEvent({ ...ok, start_date: "01/10/2026" }).ok).toBe(false);
    expect(validateEvent({ ...ok, end_date: "2026-09-30" }).ok).toBe(false);
  });
  it("rejects very long text", () => {
    expect(validateEvent({ ...ok, name: "x".repeat(121) }).ok).toBe(false);
    expect(validateEvent({ ...ok, note: "x".repeat(501) }).ok).toBe(false);
  });
});
