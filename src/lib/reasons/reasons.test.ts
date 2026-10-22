import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSku, type Evaluation, type SkuInput } from "../rules/engine";
import { addDays } from "../rules/dates";
import { checkReason } from "./check";
import { buildFacts } from "./facts";
import { GeminiError, createGemini, type TextGenerator } from "./gemini";
import { makeReason } from "./index";
import { templateReason } from "./template";

const RUN = "2026-09-14"; // a flat month
function evalFor(o: { stock: number; recent?: number; history?: number; perishable?: boolean; runDate?: string }): Evaluation {
  const runDate = o.runDate ?? RUN;
  const sales = new Map<string, number>();
  for (let i = 0; i < (o.history ?? 30); i++) sales.set(addDays(addDays(runDate, -7), -7 * i), i < 4 ? (o.recent ?? 100) : 100);
  const input: SkuInput = { sku_id: "T-1", is_perishable: o.perishable ?? false, standard_order_qty: 400, stock: o.stock, sales };
  return evaluateSku(input, runDate, DEFAULT_SETTINGS)!;
}
const ctx = (evaluation: Evaluation) => ({ evaluation, sku_name: "Classic Sev 200g", is_perishable: evaluation.numbers.window_type === "perishable" });
const returns = (text: string): TextGenerator => async () => text;

const stockout = evalFor({ stock: 300 }); // 3 weeks of stock, standard order 400
const GOOD = "Stock of 300 units covers only 3 weeks of sales, below the 6-week minimum, so a reorder of 400 units is recommended.";

describe("number check", () => {
  const facts = buildFacts(ctx(stockout));
  const check = (t: string) => checkReason(t, facts, "stockout_risk", false);
  it("accepts a reason that uses only the given figures", () => expect(check(GOOD).ok).toBe(true));
  it("rejects a figure that was not in the input", () => {
    const r = check("Stock of 300 units covers only 2 weeks of sales, below the 6-week minimum, so reorder 400 units.");
    expect(r).toMatchObject({ ok: false, kind: "number_check" });
  });
  it("rejects a rounded or recalculated figure", () => {
    expect(check("Stock of 300 units is 50% of the 6-week minimum cover, so reorder 400 units now.")).toMatchObject({ ok: false, kind: "number_check" });
  });
  it("rejects a number written as a word", () => {
    expect(check("Stock of 300 units covers only three weeks of sales, so reorder 400 units now.")).toMatchObject({ ok: false, kind: "number_check" });
  });
  it("treats 1,441 and 1441 as the same figure", () => {
    const e = evalFor({ stock: 1441 * 0 + 300, recent: 100 });
    const f = buildFacts(ctx({ ...e, numbers: { ...e.numbers, stock: 1441 } }));
    expect(checkReason("Stock of 1,441 units is well covered.", f, "stockout_risk", false).ok).toBe(true);
  });
  it("allows digits that are part of the SKU name", () => {
    expect(check("Classic Sev 200g has stock of 300 units, 3 weeks of sales, so reorder 400 units.").ok).toBe(true);
  });
});

describe("format check", () => {
  const facts = buildFacts(ctx(stockout));
  const check = (t: string, flag = "stockout_risk" as const) => checkReason(t, facts, flag, false);
  it("rejects more than one sentence", () => expect(check("Stock is low at 300 units. Reorder 400 units now please.")).toMatchObject({ ok: false, kind: "format_check" }));
  it("rejects markdown and line breaks", () => {
    expect(check("**Stock of 300 units** covers 3 weeks, so reorder 400 units.")).toMatchObject({ ok: false });
    expect(check("Stock of 300 units covers 3 weeks,\nso reorder 400 units.")).toMatchObject({ ok: false });
  });
  it("rejects wording that contradicts the flag", () => {
    expect(check("Stock of 300 units looks like overstock to me, covering 3 weeks of sales.")).toMatchObject({ ok: false, kind: "format_check" });
  });
  it("rejects a claim that an order was placed", () => {
    expect(check("An order of 400 units has been placed because stock covers 3 weeks of sales.")).toMatchObject({ ok: false });
  });
  it("rejects empty or very long text", () => {
    expect(check("Low.")).toMatchObject({ ok: false });
    expect(check("x".repeat(300))).toMatchObject({ ok: false });
  });
});

describe("makeReason", () => {
  it("uses the AI sentence when it passes both checks", async () => {
    const r = await makeReason(ctx(stockout), returns(GOOD));
    expect(r).toMatchObject({ source: "ai", fallback: null, reason: GOOD });
  });
  it("strips quotes and stray whitespace around the AI sentence", async () => {
    const r = await makeReason(ctx(stockout), returns(`  "${GOOD}"\n`));
    expect(r.source).toBe("ai");
    expect(r.reason).toBe(GOOD);
  });
  it("falls back to the template when the AI invents a number, and keeps what it wrote", async () => {
    const bad = "Stock of 300 units covers only 2 weeks of sales, below the 6-week minimum, so reorder 400 units.";
    const r = await makeReason(ctx(stockout), returns(bad));
    expect(r).toMatchObject({ source: "template", fallback: "number_check", reason: templateReason(stockout), ai_text: bad });
  });
  it("falls back when there is no key (no generator)", async () => {
    expect(await makeReason(ctx(stockout), null)).toMatchObject({ source: "template", fallback: "no_key" });
  });
  it("falls back, without throwing, when Gemini is down, slow, limited or blocked", async () => {
    for (const kind of ["api_error", "timeout", "rate_limited", "blocked"] as const) {
      const r = await makeReason(ctx(stockout), async () => { throw new GeminiError(kind, "boom"); });
      expect(r).toMatchObject({ source: "template", fallback: kind, reason: templateReason(stockout) });
    }
    const r = await makeReason(ctx(stockout), async () => { throw new Error("network exploded"); });
    expect(r).toMatchObject({ source: "template", fallback: "api_error" });
  });
  it("cannot change the flag: the evaluation is identical before and after", async () => {
    const before = JSON.stringify(stockout);
    await makeReason(ctx(stockout), returns("Stock of 5 units, so everything is fine and no order is needed at all today."));
    await makeReason(ctx(stockout), returns(GOOD));
    expect(JSON.stringify(stockout)).toBe(before);
  });
  it("hands the AI only the computed facts, as plain-English lines", async () => {
    let seen = "";
    await makeReason(ctx(stockout), async (p) => { seen = p.user; return GOOD; });
    expect(seen).toContain("- Stock on hand (units): 300");
    expect(seen).toContain("- Weeks of stock: 3");
    expect(seen).toContain("- Minimum weeks of stock allowed: 6");
    expect(seen).toContain("- Recommended order (units): 400");
    expect(seen).not.toMatch(/stock_units|weeks_of_stock|sku_id|T-1/); // no field names, no SKU id
  });
});

describe("template reasons (written by code)", () => {
  it("covers every flag type with figures from the engine", () => {
    expect(templateReason(stockout)).toBe("Stock of 300 units covers 3 weeks of sales, below the 6-week minimum; reorder 400 units now.");
    expect(templateReason(evalFor({ stock: 1500 }))).toBe("Stock of 1,500 units covers 15 weeks of sales, above the 14-week maximum; pause the next order.");
    expect(templateReason(evalFor({ stock: 1000, recent: 200 }))).toBe("Sales over the last 4 weeks averaged 200 a week against 133.33 over 12 weeks; order 600 units.");
    expect(templateReason(evalFor({ stock: 300, recent: 200 }))).toMatch(/^Urgent: .*below the 6-week minimum; order 600 units\.$/);
    expect(templateReason(evalFor({ stock: 900, history: 8 }))).toBe("Needs your judgment: only 8 weeks of sales history, so the rules cannot recommend a quantity.");
    expect(templateReason(evalFor({ stock: 580, perishable: true }))).toMatch(/above the 4-week maximum; pause the next order\.$/);
  });
  it("mentions the festival uplift when the season factor applies", () => {
    expect(templateReason(evalFor({ stock: 300, runDate: "2026-10-19" }))).toContain("after the 25% festival uplift");
  });
});

describe("Gemini client", () => {
  const okBody = (text: string) => JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });
  function harness(responses: Response[], rpm = 60) {
    let t = 10000;
    const sleeps: number[] = [];
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return responses.shift()!;
    }) as unknown as typeof fetch;
    const gen = createGemini({ apiKey: "KEY123", rpm, fetchImpl, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } })!;
    return { gen, sleeps, calls, clock: () => t };
  }
  it("is off without a key", () => expect(createGemini({ apiKey: undefined })).toBeNull());
  it("sends the key in a header, never in the URL", async () => {
    const h = harness([new Response(okBody("hello"))]);
    expect(await h.gen({ system: "s", user: "u" })).toBe("hello");
    expect(h.calls[0].url).not.toContain("KEY123");
    expect(h.calls[0].headers["x-goog-api-key"]).toBe("KEY123");
  });
  it("spaces calls out to stay under the requests-per-minute limit", async () => {
    const h = harness([new Response(okBody("a")), new Response(okBody("b")), new Response(okBody("c"))], 30); // one call every 2 seconds
    await Promise.all([h.gen({ system: "s", user: "1" }), h.gen({ system: "s", user: "2" }), h.gen({ system: "s", user: "3" })]);
    expect(h.sleeps).toEqual([2000, 2000]);
  });
  it("retries a rate-limit answer after the wait Google asks for", async () => {
    const h = harness([new Response("{}", { status: 429, headers: { "retry-after": "7" } }), new Response(okBody("fine"))]);
    expect(await h.gen({ system: "s", user: "u" })).toBe("fine");
    expect(Math.max(...h.sleeps)).toBeGreaterThanOrEqual(7000);
  });
  it("gives up as rate_limited when the wait would pass the deadline", async () => {
    const h = harness([new Response("{}", { status: 429, headers: { "retry-after": "30" } })]);
    await expect(h.gen({ system: "s", user: "u" }, h.clock() + 5000)).rejects.toMatchObject({ kind: "rate_limited" });
  });
  it("fails fast, without waiting, when the daily quota is used up", async () => {
    const quota = JSON.stringify({ error: { message: "You exceeded your current quota. Please retry in 19h59m8.15s." } });
    const h = harness([new Response(quota, { status: 429 })]);
    await expect(h.gen({ system: "s", user: "u" })).rejects.toMatchObject({ kind: "rate_limited", message: expect.stringContaining("quota") });
    expect(h.sleeps).toEqual([]); // no waiting around
  });
  it("reports other failures as api_error and blocked answers as blocked", async () => {
    await expect(harness([new Response("no", { status: 400 })]).gen({ system: "s", user: "u" })).rejects.toMatchObject({ kind: "api_error" });
    const blocked = JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] });
    await expect(harness([new Response(blocked)]).gen({ system: "s", user: "u" })).rejects.toMatchObject({ kind: "blocked" });
  });
});
