import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../rules/engine";
import { addDays } from "../rules/dates";
import { replay, type BtInput } from "./replay";

// One SKU selling 100 a week for 40 weeks. Its stock is low (below 6 weeks of sales) in weeks 20 and 21,
// and the stockout happens in week 26. A second SKU stays healthy all the time.
const START = "2025-01-06"; // a Monday
const wk = (i: number) => addDays(START, 7 * i);

function build(): BtInput {
  const sales = new Map<string, Map<string, number>>();
  const stock = new Map<string, Map<string, number>>();
  for (const id of ["A", "B"]) {
    sales.set(id, new Map(Array.from({ length: 40 }, (_, i) => [wk(i), 100] as [string, number])));
    stock.set(id, new Map(Array.from({ length: 41 }, (_, i) => [wk(i), id === "A" ? (i >= 20 && i < 22 ? 300 : 900) : 900] as [string, number])));
  }
  return {
    skus: [
      { sku_id: "A", is_perishable: false, standard_order_qty: 400, category: "x" },
      { sku_id: "B", is_perishable: false, standard_order_qty: 400, category: "x" },
    ],
    sales, stock,
    losses: [{ sku_id: "A", week_start: wk(26), type: "stockout", value_inr: 1000 }],
    settings: DEFAULT_SETTINGS,
    params: { lookback_weeks: 8, min_lead_weeks: 1 },
  };
}

describe("replay", () => {
  it("counts a stockout as caught when a stockout_risk flag came earlier, and reports the lead time", () => {
    const s = replay(build());
    expect(s.events_tested).toBe(1);
    expect(s.caught).toBe(1);
    expect(s.caught_pct).toBe(100);
    expect(s.lead_weeks.weekly_median).toBe(6); // first flag in week 20, loss in week 26
  });
  it("does not count a flag that arrives after the loss, or one outside the lookback window", () => {
    const late = build();
    late.losses = [{ sku_id: "A", week_start: wk(20), type: "stockout", value_inr: 1000 }]; // first flag is the same week: no time to act
    expect(replay(late).caught).toBe(0);
    const far = build();
    far.params = { lookback_weeks: 3, min_lead_weeks: 1 }; // flag at week 20 is 6 weeks ahead, outside a 3 week window
    expect(replay(far).caught).toBe(0);
  });
  it("does not count a write-off as caught by a stockout flag", () => {
    const b = build();
    b.losses = [{ sku_id: "A", week_start: wk(26), type: "write_off", value_inr: 500 }];
    expect(replay(b).caught).toBe(0);
  });
  it("a monthly cycle (first Monday of the month only) catches less than weekly runs", () => {
    const s = replay(build());
    expect(s.monthly_cycle.caught_pct).toBeLessThanOrEqual(s.caught_pct);
  });
  it("excludes losses from before the rules had 12 weeks of history", () => {
    const b = build();
    b.losses = [{ sku_id: "A", week_start: wk(5), type: "stockout", value_inr: 1000 }];
    const s = replay(b);
    expect(s.events_not_testable).toBe(1);
    expect(s.events_tested).toBe(0);
  });
  it("reports the flag load", () => {
    expect(replay(build()).flag_load.avg_flags_per_run).toBeGreaterThan(0);
  });
});
