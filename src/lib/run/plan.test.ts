import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSku, type Evaluation } from "../rules/engine";
import { addDays, mondayOf } from "../rules/dates";
import { planRun, sameFlag, type PendingFlag } from "./plan";
import { CRON_EXPRESSION, isAuthorizedCron, nextScheduledRun, todayIST } from "./schedule";

const RUN = "2026-09-14";
function ev(id: string, stock: number, runDate = RUN): Evaluation {
  const sales = new Map<string, number>();
  for (let i = 0; i < 30; i++) sales.set(addDays(addDays(mondayOf(runDate), -7), -7 * i), 100);
  return evaluateSku({ sku_id: id, is_perishable: false, standard_order_qty: 400, stock, sales }, runDate, DEFAULT_SETTINGS)!;
}
const asPending = (e: Evaluation, id = 1): PendingFlag => ({ id, sku_id: e.sku_id, flag_type: e.flag_type, also_types: e.also_types, urgent: e.urgent, recommended_qty: e.recommended_qty, numbers: JSON.parse(JSON.stringify(e.numbers)) });

describe("planRun: no duplicates", () => {
  it("creates a flag for a SKU with no pending flag", () => {
    const p = planRun([ev("A", 300)], [], new Set());
    expect(p.insert.map((e) => e.sku_id)).toEqual(["A"]);
  });
  it("running twice: the second run adds nothing and changes nothing", () => {
    const e = ev("A", 300);
    const p = planRun([e], [asPending(e)], new Set());
    expect(p).toMatchObject({ insert: [], refresh: [], unchanged: 1, held: 0 });
  });
  it("a later run on a different day with the same numbers is still unchanged (the run date alone does not count)", () => {
    const p = planRun([ev("A", 300, "2026-09-17")], [asPending(ev("A", 300, "2026-09-14"))], new Set());
    expect(p.unchanged).toBe(1);
  });
  it("updates a pending flag in place when its numbers change, instead of adding a second one", () => {
    const p = planRun([ev("A", 200)], [asPending(ev("A", 300), 7)], new Set());
    expect(p.insert).toEqual([]);
    expect(p.refresh).toHaveLength(1);
    expect(p.refresh[0].flagId).toBe(7);
  });
  it("key order inside the saved numbers does not matter", () => {
    const e = ev("A", 300);
    const reordered = asPending(e);
    reordered.numbers = Object.fromEntries(Object.entries(reordered.numbers).reverse());
    expect(sameFlag(e, reordered)).toBe(true);
  });
  it("leaves a pending flag alone when the rules no longer flag the SKU, and reports it", () => {
    const p = planRun([], [asPending(ev("A", 300))], new Set());
    expect(p.noLongerFlagged).toEqual(["A"]);
    expect(p.refresh).toEqual([]);
  });
});

describe("planRun: hold-back after a decision", () => {
  it("does not flag a SKU again while it is in its cooldown", () => {
    const p = planRun([ev("A", 300), ev("B", 300)], [], new Set(["A"]));
    expect(p.insert.map((e) => e.sku_id)).toEqual(["B"]);
    expect(p.held).toBe(1);
  });
  it("an existing pending flag is never hidden by the cooldown", () => {
    const e = ev("A", 300);
    expect(planRun([e], [asPending(e)], new Set(["A"]))).toMatchObject({ unchanged: 1, held: 0 });
  });
});

describe("schedule", () => {
  it("uses the UTC expression for 07:00 IST on Monday and Thursday", () => expect(CRON_EXPRESSION).toBe("30 1 * * 1,4"));
  it("the next run after Thursday 22 Oct 2026 10:00 IST is Monday 26 Oct 07:00 IST", () => {
    const next = nextScheduledRun(new Date("2026-10-22T04:30:00Z")); // 10:00 IST Thursday, after that day's run
    expect(next.toISOString()).toBe("2026-10-26T01:30:00.000Z");
  });
  it("before 07:00 IST on a run day, the next run is that same morning", () => {
    expect(nextScheduledRun(new Date("2026-10-22T00:00:00Z")).toISOString()).toBe("2026-10-22T01:30:00.000Z");
  });
  it("from Monday after 07:00 IST the next run is Thursday", () => {
    expect(nextScheduledRun(new Date("2026-10-26T02:00:00Z")).toISOString()).toBe("2026-10-29T01:30:00.000Z");
  });
  it("todayIST rolls over at 18:30 UTC", () => {
    expect(todayIST(new Date("2026-10-22T18:29:00Z"))).toBe("2026-10-22");
    expect(todayIST(new Date("2026-10-22T18:31:00Z"))).toBe("2026-10-23");
  });
});

describe("cron protection", () => {
  const secret = "a-long-random-secret-123456";
  it("accepts the right bearer token", () => expect(isAuthorizedCron(`Bearer ${secret}`, secret)).toBe(true));
  it("refuses a missing, wrong or partial token", () => {
    expect(isAuthorizedCron(null, secret)).toBe(false);
    expect(isAuthorizedCron("Bearer nope", secret)).toBe(false);
    expect(isAuthorizedCron(secret, secret)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${secret}x`, secret)).toBe(false);
  });
  it("refuses everything when no secret is configured, or it is too short", () => {
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer abc", "abc")).toBe(false);
  });
});
