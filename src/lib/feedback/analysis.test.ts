import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../rules/engine";
import { validateChange } from "../rules/settings";
import { draftSuggestions, flagValue, proposeThreshold, ruleOf, type DecidedFlag } from "./analysis";

const PS = ruleOf({ flag_type: "stockout_risk", window_type: "perishable" });
const flag = (id: number, o: Partial<DecidedFlag> = {}): DecidedFlag => ({ id, rule: PS, value: 2.5, status: "approved", tag: null, month: "2026-09", category: "Bakery & Breads", check: null, ...o });
const opts = { overrideThreshold: 10, tagThreshold: 10, settings: DEFAULT_SETTINGS };

describe("ruleOf", () => {
  it("names the rule behind each kind of flag", () => {
    expect(ruleOf({ flag_type: "stockout_risk", window_type: "standard" }).key).toBe("standard_stockout");
    expect(ruleOf({ flag_type: "stockout_risk", window_type: "perishable" }).setting).toBe("perishable_min_weeks");
    expect(ruleOf({ flag_type: "overstock_risk", window_type: "perishable" }).setting).toBe("perishable_max_weeks");
    expect(ruleOf({ flag_type: "overstock_risk", window_type: "standard" }).setting).toBe("overstock_weeks");
    expect(ruleOf({ flag_type: "high_demand", window_type: "standard" }).setting).toBe("high_demand_pct");
    expect(ruleOf({ flag_type: "needs_judgment", window_type: "standard" }).setting).toBeNull();
  });
  it("measures high demand as the % above the baseline", () => {
    expect(flagValue(ruleOf({ flag_type: "high_demand", window_type: "standard" }), { weeks_of_stock: 9, avg_recent: 150, demand_baseline: 100 })).toBe(50);
    expect(flagValue(PS, { weeks_of_stock: 2.5, avg_recent: 1, demand_baseline: 1 })).toBe(2.5);
  });
});

describe("proposeThreshold", () => {
  const rows = (over: number[], kept: number[]) => [...over.map((value) => ({ value, overridden: true })), ...kept.map((value) => ({ value, overridden: false }))];
  it("finds the mildest change that stops at least half of the overridden flags", () => {
    // minimum is 3 weeks; he overrides flags at 2.6 to 2.9 weeks and keeps those below 2
    const p = proposeThreshold(PS, 3, rows([2.6, 2.7, 2.8, 2.9], [1.0, 1.5, 1.9, 2.4]))!;
    expect(p).toMatchObject({ key: "perishable_min_weeks", from: 3, to: 2.5 });
    expect(p.what_if).toEqual({ overrides_stopped: 4, overrides_total: 4, approved_lost: 0, approved_total: 4 });
  });
  it("reports what the change would also cost: flags he approved that would stop firing", () => {
    const p = proposeThreshold(PS, 3, rows([2.2, 2.3, 2.9, 2.8], [2.6, 2.7, 1.0]))!;
    expect(p.to).toBe(2.5);
    expect(p.what_if!.approved_lost).toBe(2);
  });
  it("goes the other way for overstock rules", () => {
    const rule = ruleOf({ flag_type: "overstock_risk", window_type: "standard" });
    expect(proposeThreshold(rule, 14, rows([14.5, 15, 15.5], [20, 30]))).toMatchObject({ key: "overstock_weeks", to: 15 });
  });
  it("uses percentage steps for high demand", () => {
    const rule = ruleOf({ flag_type: "high_demand", window_type: "standard" });
    expect(proposeThreshold(rule, 20, rows([22, 24, 26], [60, 80]))).toMatchObject({ key: "high_demand_pct", to: 25 });
  });
  it("gives no proposal when nothing was overridden or the rule has no threshold", () => {
    expect(proposeThreshold(PS, 3, rows([], [1, 2]))).toBeNull();
    expect(proposeThreshold(ruleOf({ flag_type: "needs_judgment", window_type: "standard" }), 3, rows([2], []))).toBeNull();
  });
  it("gives up rather than propose an absurd threshold", () => {
    expect(proposeThreshold(PS, 3, rows([0.1, 0.1, 0.1], []))).toBeNull();
  });
});

describe("draftSuggestions", () => {
  const overrides = Array.from({ length: 12 }, (_, i) => flag(i + 1, { status: "overridden", tag: i < 9 ? "season_missed" : "competitor_scheme", value: 2.6 + (i % 3) * 0.1 }));
  const kept = Array.from({ length: 20 }, (_, i) => flag(100 + i, { value: 1.0 + (i % 5) * 0.2 }));
  it("raises a card when one rule is overridden 10 or more times in a month, naming the common reason", () => {
    const d = draftSuggestions([...overrides, ...kept], "2026-09", opts).find((x) => x.kind === "override_rate")!;
    expect(d.text).toContain("overridden 12 times in September 2026");
    expect(d.text).toContain("Season missed (9 of 12)");
    expect(d.proposal).toMatchObject({ key: "perishable_min_weeks", from: 3, to: 2.5 });
    expect(d.dedupe_key).toBe("override:perishable_stockout:2026-09");
  });
  it("does not raise a tag card below the tag threshold", () => {
    expect(draftSuggestions([...overrides, ...kept], "2026-09", opts).some((x) => x.kind === "tag")).toBe(false);
  });
  it("does not raise a card for 9 overrides", () => {
    expect(draftSuggestions([...overrides.slice(0, 9), ...kept], "2026-09", opts).some((x) => x.kind === "override_rate")).toBe(false);
  });
  it("does not count other months", () => {
    expect(draftSuggestions([...overrides.map((f) => ({ ...f, month: "2026-08" })), ...kept], "2026-09", opts)).toEqual([]);
  });
  it("raises a card when the same tag recurs, proposing the month for season_missed", () => {
    const d = draftSuggestions([...overrides, ...kept], "2026-09", { ...opts, tagThreshold: 5 }).find((x) => x.kind === "tag")!;
    expect(d.text).toContain("Season missed");
    expect(d.text).toContain("9 decisions");
    expect(d.proposal).toMatchObject({ key: "season_months", to: [3, 9, 10, 11] });
  });
  it("proposes no season change when the month is already a season month", () => {
    const oct = overrides.map((f) => ({ ...f, month: "2026-10" }));
    expect(draftSuggestions(oct, "2026-10", { ...opts, tagThreshold: 5 }).find((x) => x.kind === "tag")!.proposal).toBeNull();
  });
  it("counts how often Raghav was right on the overrides that have been checked", () => {
    const checked = overrides.map((f, i) => ({ ...f, check: (i < 8 ? "raghav_right" : "raghav_wrong") as "raghav_right" | "raghav_wrong" }));
    const d = draftSuggestions([...checked, ...kept], "2026-09", opts).find((x) => x.kind === "override_rate")!;
    expect(d.evidence).toMatchObject({ checked: 12, raghav_right: 8, raghav_wrong: 4 });
  });
});

describe("validateChange (a rule can only change to a sane value)", () => {
  it("accepts a good change", () => expect(validateChange(DEFAULT_SETTINGS, { perishable_min_weeks: 2.5 })).toEqual([]));
  it("rejects values out of range, the wrong type, and unknown settings", () => {
    expect(validateChange(DEFAULT_SETTINGS, { perishable_min_weeks: -1 }).length).toBe(1);
    expect(validateChange(DEFAULT_SETTINGS, { stockout_weeks: "six" }).length).toBe(1);
    expect(validateChange(DEFAULT_SETTINGS, { favourite_colour: 1 }).length).toBe(1);
  });
  it("keeps minimums below maximums", () => {
    expect(validateChange(DEFAULT_SETTINGS, { perishable_min_weeks: 5 })[0]).toMatch(/perishable minimum/);
    expect(validateChange(DEFAULT_SETTINGS, { stockout_weeks: 20 })[0]).toMatch(/stockout limit/);
  });
  it("checks the season months list", () => {
    expect(validateChange(DEFAULT_SETTINGS, { season_months: [3, 9, 10, 11] })).toEqual([]);
    expect(validateChange(DEFAULT_SETTINGS, { season_months: [13] }).length).toBe(1);
    expect(validateChange(DEFAULT_SETTINGS, { season_months: [3, 3] }).length).toBe(1);
  });
  it("rejects an empty change", () => expect(validateChange(DEFAULT_SETTINGS, {})).toEqual(["Nothing to change."]));
});
