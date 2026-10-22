// Reads the generated CSVs back through the real upload adapter and prints a summary.
//   npm run seed:check
import fs from "node:fs";
import path from "node:path";
import { parseCalendarEvents, parseSkus, parseSales, parseStock, parseOpenPos, parseLossEvents } from "../src/lib/csv/adapter";

const dir = path.join(process.cwd(), "data", "seed");
const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");

const calendar = parseCalendarEvents(read("calendar_events.csv"));
const skus = parseSkus(read("skus.csv"));
const sales = parseSales(read("weekly_sales.csv"));
const stock = parseStock(read("stock_snapshots.csv"));
const pos = parseOpenPos(read("open_pos.csv"));
const loss = parseLossEvents(read("loss_events.csv"));

console.log("ROW COUNTS (after the upload adapter's own validation)");
for (const [name, r] of Object.entries({ calendar_events: calendar, skus, weekly_sales: sales, stock_snapshots: stock, open_pos: pos, loss_events: loss })) {
  console.log(`  ${name.padEnd(16)} ${String(r.rows.length).padStart(6)} rows  (${r.errors.length} rejected)`);
}
const perishable = skus.rows.filter((s) => s.is_perishable).length;
console.log(`  SKUs: ${skus.rows.length} total, ${perishable} perishable`);
const weeksSet = new Set(sales.rows.map((r) => r.week_start));
console.log(`  Weeks of sales: ${weeksSet.size} (${[...weeksSet].sort()[0]} to ${[...weeksSet].sort().at(-1)})`);

// quarterly losses
const q = (d: string) => `${d.slice(0, 4)}-Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;
const agg = new Map<string, { so: number; wo: number; nso: number; nwo: number }>();
for (const e of loss.rows) {
  const a = agg.get(q(e.week_start)) ?? { so: 0, wo: 0, nso: 0, nwo: 0 };
  if (e.type === "stockout") { a.so += e.value_inr; a.nso++; } else { a.wo += e.value_inr; a.nwo++; }
  agg.set(q(e.week_start), a);
}
console.log("\nLOSSES PER QUARTER (Rs lakh)   stockouts / write-offs / total   [event counts]");
for (const [k, a] of [...agg].sort()) {
  const l = (x: number) => (x / 1e5).toFixed(1).padStart(5);
  console.log(`  ${k}  ${l(a.so)} / ${l(a.wo)} / ${l(a.so + a.wo)}   [${a.nso} stockouts, ${a.nwo} write-offs]`);
}

// planted cases, with weeks of stock recomputed from the files
const lastWeeks = [...weeksSet].sort().slice(-12);
const salesBySku = new Map<string, Map<string, number>>();
for (const r of sales.rows) {
  if (!salesBySku.has(r.sku_id)) salesBySku.set(r.sku_id, new Map());
  salesBySku.get(r.sku_id)!.set(r.week_start, r.units);
}
const latestStock = new Map<string, number>();
for (const r of stock.rows.filter((r) => r.snapshot_date === "2026-10-19")) latestStock.set(r.sku_id, r.units_on_hand);

console.log("\nPLANTED CASES (weeks of stock = stock / (1.25 x 12-week average), the uplifted figure the rules will use)");
const planted = read("planted_cases.csv").trim().split("\n").slice(1);
const rows = planted.map((line) => {
  const c = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
  return { sku_id: c[0], name: c[1], perishable: c[3], role: c[4], expected: c[5] };
});
for (const p of rows) {
  const m = salesBySku.get(p.sku_id)!;
  const vals = lastWeeks.map((w) => m.get(w)).filter((v): v is number => v !== undefined);
  const avg12 = vals.reduce((a, b) => a + b, 0) / vals.length;
  const last4 = lastWeeks.slice(-4).map((w) => m.get(w) ?? 0);
  const avg4 = last4.reduce((a, b) => a + b, 0) / 4;
  const wos = latestStock.get(p.sku_id)! / (1.25 * avg12);
  console.log(
    `  ${p.sku_id}  ${p.perishable === "true" ? "P" : " "}  ${p.role.padEnd(22)} wos ${wos.toFixed(2).padStart(5)}  4wk/12wk ${(avg4 / avg12).toFixed(2)}  weeks ${vals.length}/12  history ${m.size}  -> ${p.expected}`
  );
}
const first = (r: { errors: { line: number; message: string }[] }) => r.errors.slice(0, 3);
const bad = [skus, sales, stock, pos, loss].flatMap(first);
if (bad.length) console.log("\nREJECTED ROWS (first few):", bad);
