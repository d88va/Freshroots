import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSku, parseSettings, type RuleSettings, type SkuInput } from "./engine";
import { addDays } from "./dates";

const SEPT = "2026-09-14"; // a flat month (no season factor). Last complete week starts 2026-09-07.
const OCT = "2026-10-19"; // a festival month. Last complete week starts 2026-10-12.
const NOV = "2026-11-16";
const MAR = "2027-03-15";

interface Opts {
  stock: number;
  perishable?: boolean;
  std?: number;
  runDate?: string;
  base?: number; // weekly sales in every week (default 100)
  recent?: number; // weekly sales in the last 4 weeks (default = base)
  history?: number; // number of weeks of history, newest first (default 30)
  skipWeeks?: number[]; // positions (0 = newest) to leave out, making gaps
}

/** Builds a SKU whose sales are `base` every week and `recent` in the newest 4 weeks. */
function sku(o: Opts): SkuInput {
  const runDate = o.runDate ?? SEPT;
  const lastWeek = addDays(runDate, -7); // run dates in these tests are Mondays
  const base = o.base ?? 100;
  const sales = new Map<string, number>();
  for (let i = 0; i < (o.history ?? 30); i++) {
    if (o.skipWeeks?.includes(i)) continue;
    sales.set(addDays(lastWeek, -7 * i), i < 4 ? (o.recent ?? base) : base);
  }
  return { sku_id: "T-1", is_perishable: o.perishable ?? false, standard_order_qty: o.std ?? 400, stock: o.stock, sales };
}

/** Sales given explicitly, newest week first. */
function series(newestFirst: number[], stock: number, runDate = SEPT): SkuInput {
  const lastWeek = addDays(runDate, -7);
  const sales = new Map(newestFirst.map((u, i) => [addDays(lastWeek, -7 * i), u] as [string, number]));
  return { sku_id: "T-2", is_perishable: false, standard_order_qty: 400, stock, sales };
}

const run = (o: Opts, s: RuleSettings = DEFAULT_SETTINGS) => evaluateSku(sku(o), o.runDate ?? SEPT, s);

describe("stockout_risk (standard window, below 6 weeks)", () => {
  it("flags stock below 6 weeks of average sales and recommends the standard order quantity", () => {
    const e = run({ stock: 550 })!; // 5.5 weeks
    expect(e.flag_type).toBe("stockout_risk");
    expect(e.recommended_qty).toBe(400);
    expect(e.urgent).toBe(false);
    expect(e.numbers.weeks_of_stock).toBe(5.5);
  });
  it("does not flag at exactly 6 weeks", () => {
    expect(run({ stock: 600 })).toBeNull();
  });
});

describe("overstock_risk (standard window, above 14 weeks)", () => {
  it("flags stock above 14 weeks and recommends pausing (no quantity)", () => {
    const e = run({ stock: 1500 })!; // 15 weeks
    expect(e.flag_type).toBe("overstock_risk");
    expect(e.recommended_qty).toBeNull();
  });
  it("does not flag at exactly 14 weeks", () => {
    expect(run({ stock: 1400 })).toBeNull();
  });
});

describe("high_demand (4 weeks more than 20% above the 12-week average)", () => {
  // base 100 for weeks 5-12 and `recent` for weeks 1-4: the 12-week average moves too, so compare to what the engine computes.
  it("flags a strong surge and recommends 1.5x the standard quantity", () => {
    const e = run({ stock: 1000, recent: 200 })!; // 4wk avg 200, 12wk avg 133.3, ratio 1.5
    expect(e.flag_type).toBe("high_demand");
    expect(e.recommended_qty).toBe(600);
    expect(e.numbers.recent_vs_baseline).toBe(1.5);
  });
  it("does not flag exactly 20% above, but flags just over (it must be MORE than 20%)", () => {
    const weeks = (recent: number, older: number) => [recent, recent, recent, recent, ...Array(26).fill(older)];
    // 12-week average = (4 x 120 + 8 x 90) / 12 = 100, so the 4-week average is exactly 120% of it.
    expect(evaluateSku(series(weeks(120, 90), 1000), SEPT, DEFAULT_SETTINGS)).toBeNull();
    // (4 x 121 + 8 x 89.5) / 12 = 100, so the 4-week average is 121% of it.
    expect(evaluateSku(series(weeks(121, 89.5), 1000), SEPT, DEFAULT_SETTINGS)!.flag_type).toBe("high_demand");
  });
  it("respects the percentage setting", () => {
    const loose = run({ stock: 1000, recent: 130 }, { ...DEFAULT_SETTINGS, high_demand_pct: 5 });
    const tight = run({ stock: 1000, recent: 130 }, { ...DEFAULT_SETTINGS, high_demand_pct: 40 });
    expect(loose?.flag_type).toBe("high_demand");
    expect(tight).toBeNull();
  });
  it("rounds the 1.5x quantity to whole units", () => {
    expect(run({ stock: 1000, recent: 200, std: 125 })!.recommended_qty).toBe(188); // 187.5
  });
});

describe("season factor", () => {
  it("multiplies the 12-week average by 1.25 in October, November and March, and not in other months", () => {
    // stock 300 is a stockout risk in every month, so a flag (with its numbers) always comes back
    for (const runDate of [OCT, NOV, MAR]) expect(run({ stock: 300, runDate })!.numbers.season_factor).toBe(1.25);
    for (const runDate of [SEPT, "2026-12-14", "2027-01-18", "2027-02-15", "2027-04-19"]) {
      expect(run({ stock: 300, runDate })!.numbers.season_factor).toBe(1);
    }
  });
  it("is applied BEFORE the threshold checks: 6.5 weeks is fine in September but a stockout risk in October", () => {
    expect(run({ stock: 650, runDate: SEPT })).toBeNull();
    const e = run({ stock: 650, runDate: OCT })!; // 650 / (100 * 1.25) = 5.2 weeks
    expect(e.flag_type).toBe("stockout_risk");
    expect(e.numbers.weeks_of_stock).toBe(5.2);
  });
  it("uses the months from settings, not hard-coded ones", () => {
    const s = { ...DEFAULT_SETTINGS, season_months: [9] };
    expect(run({ stock: 650, runDate: SEPT }, s)!.numbers.season_factor).toBe(1.25);
    expect(run({ stock: 650, runDate: OCT }, s)).toBeNull();
  });
  it("uses the uplift size from settings", () => {
    const e = run({ stock: 650, runDate: OCT }, { ...DEFAULT_SETTINGS, season_uplift: 1.5 })!; // 650 / 150 = 4.33
    expect(e.numbers.weeks_of_stock).toBe(4.33);
  });

  describe("the two modes (open question for Raghav)", () => {
    // 4-week average 140, 12-week average 113.3: a raw ratio of 1.235, just above the 1.2 line.
    // With the 1.25 uplift on the baseline the line moves up to 170, so only one mode flags it.
    const opts: Opts = { stock: 1000, runDate: OCT, recent: 140 };
    it("baseline mode: the uplifted baseline raises the bar for high_demand", () => {
      const e = run(opts, { ...DEFAULT_SETTINGS, season_mode: "baseline" });
      expect(e).toBeNull(); // 140 is not above 113.3 * 1.25 * 1.2 = 170
    });
    it("weeks_check_only mode: the demand baseline is left alone, so the same SKU IS high_demand", () => {
      const e = run(opts, { ...DEFAULT_SETTINGS, season_mode: "weeks_check_only" })!;
      expect(e.flag_type).toBe("high_demand"); // 140 > 113.3 * 1.2 = 136
    });
    it("both modes use the uplifted demand figure for weeks of stock", () => {
      const a = run({ ...opts, stock: 700 }, { ...DEFAULT_SETTINGS, season_mode: "baseline" })!;
      const b = run({ ...opts, stock: 700 }, { ...DEFAULT_SETTINGS, season_mode: "weeks_check_only" })!;
      expect(a.numbers.weeks_of_stock).toBe(b.numbers.weeks_of_stock);
      expect(a.numbers.stock_baseline).toBe(b.numbers.stock_baseline);
    });
    it("baseline mode changes the needs_judgment ratio too; weeks_check_only does not", () => {
      // 4-week average 45, 12-week average 81.7: raw ratio 0.55 (fine), but 0.44 against the uplifted baseline
      const o: Opts = { stock: 1000, runDate: OCT, recent: 45 };
      expect(run(o, { ...DEFAULT_SETTINGS, season_mode: "weeks_check_only" })?.flag_type).not.toBe("needs_judgment"); // 0.55 >= 0.5
      expect(run(o, { ...DEFAULT_SETTINGS, season_mode: "baseline" })?.flag_type).toBe("needs_judgment"); // 45 / (81.7*1.25) = 0.44 < 0.5
    });
  });
});

describe("perishables: windows REPLACE the standard 6 and 14 week limits", () => {
  const p = (stock: number, more: Partial<Opts> = {}) => run({ perishable: true, stock, ...more });
  it("below 3 weeks is a stockout risk", () => {
    expect(p(290)!.flag_type).toBe("stockout_risk");
    expect(p(290)!.numbers.window_type).toBe("perishable");
  });
  it("3.1 weeks is inside the window: no flag", () => expect(p(310)).toBeNull());
  it("3.9 weeks is inside the window: no flag", () => expect(p(390)).toBeNull());
  it("above 4 weeks is an overstock risk", () => expect(p(410)!.flag_type).toBe("overstock_risk"));
  it("exactly 3 and exactly 4 weeks are not flagged", () => {
    expect(p(300)).toBeNull();
    expect(p(400)).toBeNull();
  });
  it("does NOT stack: 5.8 weeks is overstock (perishable), never stockout (the standard rule would say stockout)", () => {
    const e = p(580)!;
    expect(e.flag_type).toBe("overstock_risk");
    expect(e.also_types).toEqual([]);
    expect(run({ stock: 580 })!.flag_type).toBe("stockout_risk"); // the same stock on a non-perishable
  });
  it("a perishable SKU at 5 weeks never reads as a stockout", () => {
    expect(p(500)!.flag_type).toBe("overstock_risk");
  });
  it("the high-demand rule still applies to perishables", () => {
    const e = p(350, { recent: 200 })!; // 350 / 133.3 = 2.6 weeks -> below 3
    expect(e.flag_type).toBe("high_demand");
    expect(e.also_types).toEqual(["stockout_risk"]);
    const inWindow = p(450, { recent: 200 })!; // 3.4 weeks: inside the window, still high demand
    expect(inWindow.flag_type).toBe("high_demand");
    expect(inWindow.also_types).toEqual([]);
  });
  it("uses the perishable limits from settings", () => {
    expect(p(310)).toBeNull();
    const s = { ...DEFAULT_SETTINGS, perishable_min_weeks: 3.5 };
    expect(run({ perishable: true, stock: 310 }, s)!.flag_type).toBe("stockout_risk");
  });
});

describe("precedence", () => {
  it("high_demand and stockout_risk together: one flag, urgent, 1.5x, both types kept", () => {
    const e = run({ stock: 300, recent: 200 })!; // 2.25 weeks of a 133.3 average
    expect(e.flag_type).toBe("high_demand");
    expect(e.also_types).toEqual(["stockout_risk"]);
    expect(e.urgent).toBe(true);
    expect(e.recommended_qty).toBe(600);
  });
  it("high_demand with healthy stock is not urgent", () => {
    const e = run({ stock: 1000, recent: 200 })!;
    expect(e.urgent).toBe(false);
    expect(e.also_types).toEqual([]);
  });
  it("high_demand and overstock together: both kept, nothing recommended, marked as a conflict for Raghav", () => {
    const e = run({ stock: 5000, recent: 200 })!; // 37 weeks of stock but demand surging
    expect(e.flag_type).toBe("overstock_risk");
    expect(e.also_types).toEqual(["high_demand"]);
    expect(e.recommended_qty).toBeNull();
    expect(e.numbers.conflict).toBe(true);
  });
  it("needs_judgment wins over everything: no other flag and no quantity", () => {
    const e = run({ stock: 50, recent: 500 })!; // would be stockout + high demand, but demand is 2.1x its 12-week average
    expect(e.flag_type).toBe("needs_judgment");
    expect(e.also_types).toEqual([]);
    expect(e.recommended_qty).toBeNull();
    expect(e.urgent).toBe(false);
    expect(e.numbers.context_flags).toContain("stockout_risk"); // shown as context only
  });
});

describe("needs_judgment triggers", () => {
  it("fewer than 12 weeks of history (new launch)", () => {
    const e = run({ stock: 900, history: 8 })!;
    expect(e.flag_type).toBe("needs_judgment");
    expect(e.numbers.triggers).toEqual(["short_history"]);
    expect(e.numbers.history_weeks).toBe(8);
  });
  it("exactly 12 weeks of history is enough", () => {
    expect(run({ stock: 900, history: 12 })).toBeNull();
  });
  it("a missing week inside the last 12 (gappy data)", () => {
    const e = run({ stock: 900, skipWeeks: [6] })!;
    expect(e.flag_type).toBe("needs_judgment");
    expect(e.numbers.triggers).toEqual(["missing_weeks"]);
    expect(e.numbers.missing_weeks).toBe(1);
  });
  it("weeks before the launch are not counted as gaps", () => {
    const e = run({ stock: 900, history: 8 })!;
    expect(e.numbers.missing_weeks).toBe(0);
  });
  it("a gap outside the 12-week window is ignored", () => {
    expect(run({ stock: 900, skipWeeks: [15] })).toBeNull();
  });
  it("4-week average more than 2x the 12-week average", () => {
    const e = run({ stock: 900, recent: 400 })!; // 4wk 400, 12wk 200 -> exactly 2.0, not more than 2
    expect(e.flag_type).not.toBe("needs_judgment");
    const e2 = run({ stock: 900, recent: 500 })!; // 4wk 500, 12wk 233 -> 2.14
    expect(e2.flag_type).toBe("needs_judgment");
    expect(e2.numbers.triggers).toEqual(["demand_surge"]);
  });
  it("4-week average less than 0.5x the 12-week average", () => {
    const e = run({ stock: 900, recent: 40 }); // 4wk 40, 12wk 80 -> exactly 0.5, not less than 0.5
    expect(e?.flag_type).not.toBe("needs_judgment");
    const e2 = run({ stock: 900, recent: 30 })!; // 4wk 30, 12wk 76.7 -> 0.39
    expect(e2.flag_type).toBe("needs_judgment");
    expect(e2.numbers.triggers).toEqual(["demand_drop"]);
  });
  it("no sales at all", () => {
    const e = evaluateSku({ sku_id: "T-0", is_perishable: false, standard_order_qty: 100, stock: 50, sales: new Map() }, SEPT, DEFAULT_SETTINGS)!;
    expect(e.flag_type).toBe("needs_judgment");
    expect(e.numbers.triggers).toContain("no_sales");
  });
  it("all-zero sales are not silently treated as normal", () => {
    expect(run({ stock: 100, base: 0 })!.flag_type).toBe("needs_judgment");
  });
  it("can report more than one trigger", () => {
    const e = run({ stock: 900, history: 8, skipWeeks: [2] })!; // 7 weeks of history, with a hole in it
    expect(e.numbers.triggers).toEqual(["short_history", "missing_weeks"]);
  });
  it("thresholds come from settings", () => {
    const s = { ...DEFAULT_SETTINGS, judgment_min_history_weeks: 6 };
    expect(run({ stock: 900, history: 8 }, s)).toBeNull();
  });
});

describe("the engine is pure", () => {
  it("never looks at weeks after the run date", () => {
    const input = sku({ stock: 900 });
    const future = new Map(input.sales);
    future.set(addDays(SEPT, 7), 9999);
    future.set(addDays(SEPT, 14), 9999);
    expect(evaluateSku({ ...input, sales: future }, SEPT, DEFAULT_SETTINGS)).toEqual(evaluateSku(input, SEPT, DEFAULT_SETTINGS));
  });
  it("does not change its inputs, and gives the same answer every time", () => {
    const input = sku({ stock: 300, recent: 200 });
    const before = JSON.stringify([...input.sales]);
    const settingsBefore = JSON.stringify(DEFAULT_SETTINGS);
    const a = evaluateSku(input, OCT, DEFAULT_SETTINGS);
    const b = evaluateSku(input, OCT, DEFAULT_SETTINGS);
    expect(a).toEqual(b);
    expect(JSON.stringify([...input.sales])).toBe(before);
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(settingsBefore);
  });
});

describe("parseSettings", () => {
  const rows = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value }));
  it("reads every setting", () => expect(parseSettings(rows)).toEqual(DEFAULT_SETTINGS));
  it("fails loudly when a setting is missing", () => {
    expect(() => parseSettings(rows.filter((r) => r.key !== "stockout_weeks"))).toThrow(/stockout_weeks/);
  });
});
