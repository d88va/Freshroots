// Dry run of the rules engine on the data in Neon. Nothing is saved: no run, no flags.
//   npm run rules:dry [runDate]
// Shows how many SKUs land in each flag type, in both season modes, and checks the planted demo cases.
import fs from "node:fs";
import path from "node:path";
import { getSql } from "../src/lib/db/client";
import { evaluateAll, parseSettings, type Evaluation, type FlagType, type RuleSettings, type SkuInput } from "../src/lib/rules/engine";

const runDate = process.argv[2] ?? "2026-10-19";

async function main() {
  const sql = getSql();
  const settings = parseSettings((await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[]);
  const skus = (await sql.query("select sku_id, is_perishable, standard_order_qty from skus order by sku_id")) as { sku_id: string; is_perishable: boolean; standard_order_qty: number }[];
  const sales = (await sql.query("select sku_id, to_char(week_start, 'YYYY-MM-DD') as w, units from weekly_sales")) as { sku_id: string; w: string; units: number }[];
  const stock = (await sql.query(
    "select distinct on (sku_id) sku_id, units_on_hand from stock_snapshots where snapshot_date <= $1 order by sku_id, snapshot_date desc", [runDate]
  )) as { sku_id: string; units_on_hand: number }[];

  const salesBy = new Map<string, Map<string, number>>();
  for (const r of sales) {
    if (!salesBy.has(r.sku_id)) salesBy.set(r.sku_id, new Map());
    salesBy.get(r.sku_id)!.set(r.w, r.units);
  }
  const stockBy = new Map(stock.map((r) => [r.sku_id, r.units_on_hand]));
  const inputs: SkuInput[] = skus.map((s) => ({ ...s, stock: stockBy.get(s.sku_id) ?? 0, sales: salesBy.get(s.sku_id) ?? new Map() }));

  const tally = (evals: Evaluation[]) => {
    const t: Record<string, number> = { high_demand: 0, stockout_risk: 0, overstock_risk: 0, needs_judgment: 0, urgent: 0, conflict: 0 };
    for (const e of evals) { t[e.flag_type]++; if (e.urgent) t.urgent++; if (e.numbers.conflict) t.conflict++; }
    return t;
  };
  const show = (label: string, s: RuleSettings, date: string) => {
    const evals = evaluateAll(inputs, date, s);
    const t = tally(evals);
    console.log(`\n${label}  (run date ${date}, season factor ${evals[0]?.numbers.season_factor ?? "n/a"}, mode ${s.season_mode})`);
    console.log(`  flagged ${evals.length} of ${inputs.length} SKUs, ${inputs.length - evals.length} need no action`);
    console.log(`  high_demand ${t.high_demand} (of which urgent, also stockout: ${t.urgent}) | stockout_risk ${t.stockout_risk} | overstock_risk ${t.overstock_risk} | needs_judgment ${t.needs_judgment}`);
    if (t.conflict) console.log(`  high_demand + overstock conflicts: ${t.conflict}`);
    return evals;
  };

  console.log("Settings from Neon:", JSON.stringify(settings));
  const main = show("MAIN RUN", settings, runDate);
  show("SAME RUN, other season mode", { ...settings, season_mode: settings.season_mode === "baseline" ? "weeks_check_only" : "baseline" }, runDate);
  show("SAME DATA, a flat month (no season factor)", settings, "2026-09-14");
  const noPerish = evaluateAll(inputs.map((i) => ({ ...i, is_perishable: false })), runDate, settings);
  console.log(`\nIf perishables used the standard 6 and 14 week limits instead: ${tally(noPerish).stockout_risk} stockout_risk (vs ${tally(main).stockout_risk} with the perishable windows)`);

  // planted cases
  const planted = fs.readFileSync(path.join(process.cwd(), "data/seed/planted_cases.csv"), "utf8").trim().split("\n").slice(1).map((line) => {
    const c = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
    return { sku_id: c[0], role: c[4], expected: c[5] };
  });
  const byId = new Map(main.map((e) => [e.sku_id, e]));
  const TYPES: FlagType[] = ["high_demand", "stockout_risk", "overstock_risk", "needs_judgment"];
  let ok = 0;
  const bad: string[] = [];
  for (const p of planted) {
    const want = new Set(TYPES.filter((t) => p.expected.includes(t)));
    const e = byId.get(p.sku_id);
    const got = new Set<FlagType>(e ? [e.flag_type, ...e.also_types] : []);
    const urgentOk = !p.expected.includes("urgent") || !!e?.urgent;
    const match = want.size === got.size && [...want].every((t) => got.has(t)) && urgentOk;
    if (match) ok++; else bad.push(`  ${p.sku_id} ${p.role}: expected "${p.expected}", got ${e ? [e.flag_type, ...e.also_types].join("+") + (e.urgent ? " urgent" : "") : "no flag"}`);
  }
  console.log(`\nPLANTED CASES: ${ok} of ${planted.length} match what they were designed to do`);
  bad.forEach((b) => console.log(b));

  // flags that are NOT planted
  const plantedIds = new Set(planted.map((p) => p.sku_id));
  const stray = main.filter((e) => !plantedIds.has(e.sku_id));
  console.log(`\nFlags on SKUs that were NOT planted: ${stray.length}`);
  stray.slice(0, 8).forEach((e) => console.log(`  ${e.sku_id} ${e.flag_type} wos ${e.numbers.weeks_of_stock} ratio ${e.numbers.recent_vs_baseline} triggers ${e.numbers.triggers.join(",")}`));

  console.log("\nSAMPLE FLAGS (what the engine computes)");
  for (const id of ["FR-074", "FR-202", "FR-263", "FR-013", "FR-343", "FR-347", "FR-310", "FR-004"]) {
    const e = byId.get(id);
    if (!e) continue;
    const n = e.numbers;
    console.log(`  ${id} ${e.flag_type}${e.also_types.length ? "+" + e.also_types.join("+") : ""}${e.urgent ? " URGENT" : ""} qty ${e.recommended_qty ?? "-"} | stock ${n.stock}, 4wk ${n.avg_recent}, 12wk ${n.avg_baseline} x${n.season_factor}, weeks ${n.weeks_of_stock} (${n.window_type} ${n.min_weeks}-${n.max_weeks})${n.triggers.length ? " triggers " + n.triggers.join(",") : ""}`);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
