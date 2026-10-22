// Learning from history. Pure functions: weekly sales in, a monthly demand index out.
// This only ever produces SUGGESTIONS. Nothing here changes a season factor or a flag.
//
// Method: for every week, compare sales with the average of the 53 weeks around it (26 before, 26 after).
// That average moves with the business, so general growth is not mistaken for seasonality.
// A month's index is the sum of its weeks' sales divided by the sum of those weeks' 53-week averages:
// 1.00 is a normal month, 1.25 is a month running 25% above normal.

import { addDays, mondayOf } from "../rules/dates";

export interface WeeklyPoint { week: string; units: number } // week = the Monday

export interface MonthIndex { month: number; index: number | null; weeks: number; years: number }

const HALF_WINDOW = 26;
const MIN_WEEKS = 6; // fewer weeks than this and a month is not reported

export function monthlyIndex(series: WeeklyPoint[], half = HALF_WINDOW): MonthIndex[] {
  const sales = new Map(series.map((p) => [p.week, p.units]));
  const acc = Array.from({ length: 12 }, () => ({ units: 0, base: 0, weeks: 0, years: new Set<string>() }));
  for (const p of series) {
    let sum = 0, n = 0;
    for (let k = -half; k <= half; k++) {
      const u = sales.get(addDays(p.week, 7 * k));
      if (u === undefined) { n = -1; break; } // the window must be complete
      sum += u; n++;
    }
    if (n < 0) continue;
    const m = Number(p.week.slice(5, 7)) - 1;
    acc[m].units += p.units;
    acc[m].base += sum / n;
    acc[m].weeks++;
    acc[m].years.add(p.week.slice(0, 4));
  }
  return acc.map((a, i) => ({ month: i + 1, index: a.weeks >= MIN_WEEKS && a.base > 0 ? Math.round((a.units / a.base) * 100) / 100 : null, weeks: a.weeks, years: a.years.size }));
}

/** The factor the rules apply in each month right now: the uplift in the season months, 1.0 otherwise. */
export function activeFactors(seasonMonths: number[], uplift: number): number[] {
  return Array.from({ length: 12 }, (_, i) => (seasonMonths.includes(i + 1) ? uplift : 1));
}

export interface GapCard {
  category: string; month: number; index: number; active: number; gap: number; weeks: number; years: number;
  direction: "above" | "below";
}

/** Months where the learned pattern differs sharply from the active factor, biggest gap first. */
export function findGaps(byCategory: Record<string, MonthIndex[]>, active: number[], threshold: number): GapCard[] {
  const out: GapCard[] = [];
  for (const [category, months] of Object.entries(byCategory)) {
    for (const m of months) {
      if (m.index === null) continue;
      const gap = Math.round((m.index - active[m.month - 1]) * 100) / 100;
      if (Math.abs(gap) + 1e-9 >= threshold) out.push({ category, month: m.month, index: m.index, active: active[m.month - 1], gap, weeks: m.weeks, years: m.years, direction: gap > 0 ? "above" : "below" });
    }
  }
  return out.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

/**
 * How sales behaved during an event, against the same weeks one year earlier (all SKUs together).
 * Last year is the fair yardstick: it carries the same season, so a festival is not mistaken for an effect.
 * It still includes about a year of general growth. Returns null when last year's weeks are not in the data.
 */
export function eventEffect(totals: ReadonlyMap<string, number>, start: string, end: string): { ratio: number; weeks: number } | null {
  let now = 0, before = 0, weeks = 0;
  for (let w = mondayOf(start); w <= end; w = addDays(w, 7)) {
    const a = totals.get(w), b = totals.get(addDays(w, -364)); // 52 weeks earlier is the same weekday, a year ago
    if (a === undefined || b === undefined) continue;
    now += a; before += b; weeks++;
  }
  if (!weeks || before === 0) return null;
  return { ratio: Math.round((now / before) * 100) / 100, weeks };
}
