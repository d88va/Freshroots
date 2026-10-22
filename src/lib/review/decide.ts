// HUMAN GATE (orders): the rules for what Raghav can do with a flag. Pure functions, enforced again on the server.
// Nothing reaches the Orders page unless a flag is approved or edited here.

export const TAGS = ["season_missed", "new_launch", "competitor_scheme", "data_wrong", "other"] as const;
export type Tag = (typeof TAGS)[number];
export const TAG_LABELS: Record<Tag, string> = {
  season_missed: "Season missed",
  new_launch: "New launch",
  competitor_scheme: "Competitor scheme",
  data_wrong: "Data is wrong",
  other: "Other",
};

export interface FlagForDecision {
  flag_type: "high_demand" | "stockout_risk" | "overstock_risk" | "needs_judgment";
  recommended_qty: number | null;
  numbers: { conflict?: boolean };
  status: string;
}

export type DecisionInput =
  | { action: "approve"; tag?: string | null; text?: string | null }
  | { action: "edit"; qty: number; tag?: string | null; text?: string | null }
  | { action: "override"; tag?: string | null; text?: string | null };

export type DecisionResult =
  | { ok: true; status: "approved" | "edited" | "overridden"; final_qty: number | null; tag: Tag | null; text: string | null }
  | { ok: false; error: string };

/** Needs-judgment flags, and flags whose rules point in opposite directions, are decided one at a time. */
export const needsOwnDecision = (f: Pick<FlagForDecision, "flag_type" | "numbers">) => f.flag_type === "needs_judgment" || f.numbers?.conflict === true;

/** "Approve all" may only touch flags that are pending and do not need Raghav's own judgment. */
export const bulkEligible = (f: FlagForDecision) => f.status === "pending" && !needsOwnDecision(f);

/** A pause (overstock) has no order quantity. */
export const isPause = (f: Pick<FlagForDecision, "recommended_qty" | "flag_type">) => f.recommended_qty === null && f.flag_type !== "needs_judgment";

export function validateDecision(flag: FlagForDecision, input: DecisionInput): DecisionResult {
  if (flag.status !== "pending") return { ok: false, error: "This flag has already been decided." };

  const tag = input.tag ?? null;
  if (tag !== null && !(TAGS as readonly string[]).includes(tag)) return { ok: false, error: `Unknown reason tag "${tag}".` };
  const text = (input.text ?? "").trim() || null;
  if (tag === "other" && !text) return { ok: false, error: 'Please say what "Other" means.' };

  switch (input.action) {
    case "approve":
      if (needsOwnDecision(flag)) return { ok: false, error: "This flag needs your own decision. Enter a quantity or override it." };
      return { ok: true, status: "approved", final_qty: flag.recommended_qty, tag: tag as Tag | null, text };
    case "edit": {
      if (isPause(flag) && !flag.numbers?.conflict) return { ok: false, error: "A pause has no quantity to edit. Approve it, or override it." };
      if (!Number.isInteger(input.qty) || input.qty <= 0) return { ok: false, error: "Quantity must be a whole number above zero." };
      if (input.qty > 10_000_000) return { ok: false, error: "That quantity looks too large." };
      return { ok: true, status: "edited", final_qty: input.qty, tag: tag as Tag | null, text };
    }
    case "override":
      if (tag === null) return { ok: false, error: "Pick a reason tag to override." };
      return { ok: true, status: "overridden", final_qty: null, tag: tag as Tag, text };
  }
}
