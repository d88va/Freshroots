// Shows reasons for five real flags, then the failure cases. Nothing is saved.   npm run reasons:demo
// With GEMINI_API_KEY set the five reasons come from Gemini; without it they fall back to templates.
import { getSql } from "../src/lib/db/client";
import { loadHistory } from "../src/lib/db/history";
import { evaluateSku, parseSettings, type Evaluation } from "../src/lib/rules/engine";
import { makeReason, type ReasonResult } from "../src/lib/reasons";
import { geminiFromEnv, GeminiError, type TextGenerator } from "../src/lib/reasons/gemini";
import { templateReason } from "../src/lib/reasons/template";

const RUN = "2026-10-19";
const FIVE = ["FR-074", "FR-202", "FR-263", "FR-013", "FR-343"]; // high demand, stockout, overstock, urgent, perishable
const line = (label: string, r: ReasonResult, e: Evaluation) =>
  console.log(`\n${label} ${e.sku_id} [${e.flag_type}${e.also_types.length ? "+" + e.also_types.join("+") : ""}${e.urgent ? " URGENT" : ""}, qty ${e.recommended_qty ?? "-"}]\n  source: ${r.source}${r.fallback ? ` (fallback: ${r.fallback}${r.detail ? " - " + r.detail : ""})` : ""}${r.latency_ms ? `, ${r.latency_ms}ms` : ""}\n  reason: ${r.reason}${r.ai_text && r.source === "template" ? `\n  AI wrote (thrown away): ${r.ai_text}` : ""}`);

async function main() {
  const sql = getSql();
  const settings = parseSettings((await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[]);
  const h = await loadHistory(sql);
  const names = new Map(((await sql.query("select sku_id, name from skus")) as { sku_id: string; name: string }[]).map((r) => [r.sku_id, r.name]));
  const evalOf = (id: string): Evaluation => {
    const s = h.skus.find((x) => x.sku_id === id)!;
    return evaluateSku({ ...s, stock: h.stock.get(id)?.get(RUN) ?? 0, sales: h.sales.get(id) ?? new Map() }, RUN, settings)!;
  };
  const ctx = (e: Evaluation) => ({ evaluation: e, sku_name: names.get(e.sku_id)!, is_perishable: e.numbers.window_type === "perishable" });

  const gen = geminiFromEnv();
  console.log(gen ? `Gemini key found (model ${process.env.GEMINI_MODEL || "gemini-3.5-flash"}). Five flags, one at a time:` : "No GEMINI_API_KEY set, so every reason falls back to its template. Five flags:");
  for (const id of FIVE) { const e = evalOf(id); line("FLAG", await makeReason(ctx(e), gen), e); }

  console.log("\n=== FAILURE CASES (deliberate) ===");
  const stockout = evalOf("FR-202");
  const invented: TextGenerator = async () => `Stock of ${stockout.numbers.stock} units covers only 2 weeks of sales, so reorder ${stockout.recommended_qty} units now.`;
  line("1. AI invents a figure (2 weeks)", await makeReason(ctx(stockout), invented), stockout);
  const down: TextGenerator = async () => { throw new GeminiError("api_error", "Gemini returned 503 (simulated outage)"); };
  const overstock = evalOf("FR-263");
  line("2. Gemini is down", await makeReason(ctx(overstock), down), overstock);
  const wording: TextGenerator = async () => "This SKU is actually running low and needs an urgent reorder to avoid a shortage.";
  const over = evalOf("FR-263");
  line("3. AI contradicts the flag", await makeReason(ctx(over), wording), over);
  const nj = evalOf("FR-310");
  line("4. needs_judgment, AI offline", await makeReason(ctx(nj), null), nj);
  console.log("\nTemplate for FR-202 for comparison:", templateReason(stockout));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
