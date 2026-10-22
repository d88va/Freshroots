import { describe, expect, it } from "vitest";
import { bulkEligible, needsOwnDecision, validateDecision, type FlagForDecision } from "./decide";

const flag = (o: Partial<FlagForDecision> = {}): FlagForDecision => ({ flag_type: "stockout_risk", recommended_qty: 400, numbers: {}, status: "pending", ...o });
const pause = flag({ flag_type: "overstock_risk", recommended_qty: null });
const judgment = flag({ flag_type: "needs_judgment", recommended_qty: null });
const conflict = flag({ flag_type: "overstock_risk", recommended_qty: null, numbers: { conflict: true } });

describe("approve", () => {
  it("approves at the recommended quantity", () => expect(validateDecision(flag(), { action: "approve" })).toMatchObject({ ok: true, status: "approved", final_qty: 400 }));
  it("approving a pause records no quantity (no order is created)", () => expect(validateDecision(pause, { action: "approve" })).toMatchObject({ ok: true, status: "approved", final_qty: null }));
  it("a tag is optional", () => expect(validateDecision(flag(), { action: "approve", tag: null })).toMatchObject({ ok: true, tag: null }));
  it("accepts a tag", () => expect(validateDecision(flag(), { action: "approve", tag: "season_missed" })).toMatchObject({ ok: true, tag: "season_missed" }));
});

describe("human gate", () => {
  it("a needs_judgment flag cannot be approved", () => expect(validateDecision(judgment, { action: "approve" })).toMatchObject({ ok: false }));
  it("a flag whose rules conflict cannot be approved either", () => expect(validateDecision(conflict, { action: "approve" })).toMatchObject({ ok: false }));
  it("needs_judgment and conflicts are never eligible for bulk approval", () => {
    expect(bulkEligible(judgment)).toBe(false);
    expect(bulkEligible(conflict)).toBe(false);
    expect(needsOwnDecision(judgment)).toBe(true);
  });
  it("ordinary pending flags are eligible, decided flags are not", () => {
    expect(bulkEligible(flag())).toBe(true);
    expect(bulkEligible(pause)).toBe(true);
    expect(bulkEligible(flag({ status: "approved" }))).toBe(false);
  });
  it("a flag that was already decided cannot be decided again", () => {
    for (const action of ["approve", "override"] as const) expect(validateDecision(flag({ status: "approved" }), { action, tag: "other", text: "x" })).toMatchObject({ ok: false });
  });
});

describe("edit", () => {
  it("saves Raghav's quantity", () => expect(validateDecision(flag(), { action: "edit", qty: 250 })).toMatchObject({ ok: true, status: "edited", final_qty: 250 }));
  it("rejects zero, negatives, fractions and absurd numbers", () => {
    for (const qty of [0, -5, 12.5, 99_999_999, NaN]) expect(validateDecision(flag(), { action: "edit", qty })).toMatchObject({ ok: false });
  });
  it("lets him order on a needs_judgment flag by typing his own quantity", () => expect(validateDecision(judgment, { action: "edit", qty: 300 })).toMatchObject({ ok: true, status: "edited", final_qty: 300 }));
  it("lets him resolve a conflict by typing a quantity", () => expect(validateDecision(conflict, { action: "edit", qty: 100 })).toMatchObject({ ok: true }));
  it("does not let him edit a plain pause", () => expect(validateDecision(pause, { action: "edit", qty: 100 })).toMatchObject({ ok: false }));
});

describe("override", () => {
  it("requires a tag", () => expect(validateDecision(flag(), { action: "override" })).toMatchObject({ ok: false }));
  it("works with a tag and records no quantity", () => expect(validateDecision(flag(), { action: "override", tag: "competitor_scheme" })).toMatchObject({ ok: true, status: "overridden", final_qty: null, tag: "competitor_scheme" }));
  it("'other' needs free text, on any action", () => {
    expect(validateDecision(flag(), { action: "override", tag: "other" })).toMatchObject({ ok: false });
    expect(validateDecision(flag(), { action: "override", tag: "other", text: "  " })).toMatchObject({ ok: false });
    expect(validateDecision(flag(), { action: "override", tag: "other", text: "Distributor strike" })).toMatchObject({ ok: true, text: "Distributor strike" });
    expect(validateDecision(flag(), { action: "approve", tag: "other" })).toMatchObject({ ok: false });
  });
  it("rejects an unknown tag", () => expect(validateDecision(flag(), { action: "override", tag: "because" })).toMatchObject({ ok: false }));
  it("works on a needs_judgment flag (decide not to order)", () => expect(validateDecision(judgment, { action: "override", tag: "new_launch" })).toMatchObject({ ok: true, status: "overridden" }));
});
