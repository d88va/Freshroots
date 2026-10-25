import { describe, expect, it } from "vitest";
import { changeNote, isPoDate, poNumberForDate, summarize } from "./format";

describe("purchase order numbers", () => {
  it("come from the day, so the same day is always the same number", () => { expect(poNumberForDate("2026-10-23")).toBe("FR-PO-20261023"); expect(poNumberForDate("2026-01-05")).toBe("FR-PO-20260105"); });
  it("only real dates name a purchase order", () => {
    expect(isPoDate("2026-10-23")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "20261023", "2026-1-5", "abc", "2026-10-23; drop table", ""]) expect(isPoDate(bad)).toBe(false);
  });
});

describe("summarising a purchase order", () => {
  const l = (category: string, quantity: number, status = "approved") => ({ category, quantity, status });
  it("adds lines and units, with subtotals by category, biggest first", () => {
    const s = summarize([l("Oils", 100), l("Namkeen", 250), l("Oils", 50, "edited")]);
    expect(s).toMatchObject({ lines: 3, units: 400, edited: 1 });
    expect(s.byCategory).toEqual([{ category: "Namkeen", lines: 1, units: 250 }, { category: "Oils", lines: 2, units: 150 }]);
  });
  it("an empty day totals zero", () => expect(summarize([])).toEqual({ lines: 0, units: 0, edited: 0, byCategory: [] }));
  it("breaks ties by category name so the order never jumps around", () => {
    expect(summarize([l("B", 10), l("A", 10)]).byCategory.map((c) => c.category)).toEqual(["A", "B"]);
  });
});

describe("showing what Raghav changed", () => {
  it("says so when he edited the quantity", () => expect(changeNote({ quantity: 400, recommended_qty: 555, status: "edited" })).toBe("Quantity changed by Raghav from 555 (-155)"));
  it("says so when he raised it", () => expect(changeNote({ quantity: 600, recommended_qty: 555, status: "edited" })).toBe("Quantity changed by Raghav from 555 (+45)"));
  it("says nothing for an approved line, an unchanged edit, or a judgment order with no recommendation", () => {
    expect(changeNote({ quantity: 100, recommended_qty: 100, status: "approved" })).toBeNull();
    expect(changeNote({ quantity: 100, recommended_qty: 100, status: "edited" })).toBeNull();
    expect(changeNote({ quantity: 300, recommended_qty: null, status: "edited" })).toBeNull();
  });
});
