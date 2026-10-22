// DEMO DATA: replays the rules on past Mondays and Thursdays and simulates Raghav's decisions with backdated dates,
// so the feedback loop has something to learn from.   npm run seed:history -- [--dry] [--reset]
// The decisions follow a documented behaviour model (below), with a fixed random seed. They are NOT real decisions.
import { getSql } from "../src/lib/db/client";
import { loadHistory } from "../src/lib/db/history";
import { addDays } from "../src/lib/rules/dates";
import { evaluateSku, parseSettings, type Evaluation } from "../src/lib/rules/engine";
import { templateReason } from "../src/lib/reasons/template";
import { ruleOf } from "../src/lib/feedback/analysis";

const DRY = process.argv.includes("--dry");
const RESET = process.argv.includes("--reset");
const FIRST_RUN = "2026-07-20", LAST_RUN = "2026-09-21", COOLDOWN_DAYS = 7; // Mondays only: the data changes weekly, so a Thursday run adds nothing new
const NOTE = "Demo history (seeded)";

function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(20261022);
const chance = (p: number) => rand() < p;
const pick = <T,>(xs: [T, number][]) => { let r = rand() * xs.reduce((a, [, w]) => a + w, 0); for (const [x, w] of xs) { if ((r -= w) <= 0) return x; } return xs[xs.length - 1][0]; };
type Tag = "season_missed" | "new_launch" | "competitor_scheme" | "data_wrong" | "other";
const OTHER_TEXT = ["Distributor already holds stock for the festival", "Supplier confirmed an early delivery", "Scheme ending, demand will drop", "Regional strike, orders delayed anyway"];

interface Seeded { runDate: string; e: Evaluation; status: "approved" | "edited" | "overridden"; qty: number | null; tag: Tag | null; text: string | null; rating: "up" | "down" | null; createdAt: string; decidedAt: string }

// THE BEHAVIOUR MODEL. Three phases. Early on Raghav mostly agrees. In August he starts overriding the perishable minimum
// ("the festival season is starting early"), which is exactly the pattern the feedback loop should surface. From the end of
// August the volume of flags wears him down and he overrides more of everything (a rate that lands in the amber zone of K3).
type Phase = "early" | "aug" | "late";
const phaseOf = (d: string): Phase => (d < "2026-08-03" ? "early" : d < "2026-08-31" ? "aug" : "late");
const P: Record<Phase, Record<string, number>> = {
  early: { perishable_stockout: 0.1, standard_stockout: 0.05, high_demand: 0.1, standard_overstock: 0.05, perishable_overstock: 0.06, needs_judgment: 0.4 },
  aug: { perishable_stockout: 0.6, standard_stockout: 0.12, high_demand: 0.2, standard_overstock: 0.1, perishable_overstock: 0.12, needs_judgment: 0.45 },
  late: { perishable_stockout: 0.4, standard_stockout: 0.21, high_demand: 0.25, standard_overstock: 0.12, perishable_overstock: 0.15, needs_judgment: 0.5 },
};

function decide(e: Evaluation, runDate: string): { status: Seeded["status"]; qty: number | null; tag: Tag | null; text: string | null } {
  const rule = ruleOf({ flag_type: e.flag_type, window_type: e.numbers.window_type }).key;
  const phase = phaseOf(runDate);
  const std = e.numbers.standard_order_qty;
  const edited = (base: number) => ({ status: "edited" as const, qty: Math.max(10, Math.round((base * (0.6 + rand() * 0.8)) / 10) * 10) });
  const overrideWith = (tags: [Tag, number][]) => { const tag = pick(tags); return { status: "overridden" as const, qty: null, tag, text: tag === "other" ? OTHER_TEXT[Math.floor(rand() * OTHER_TEXT.length)] : null }; };
  const keep = (tagP: number) => ({ tag: chance(tagP) ? pick<Tag>([["season_missed", 5], ["competitor_scheme", 3], ["data_wrong", 1]]) : null, text: null as string | null });
  // A real planner overrides the borderline flags (close to the threshold) far more often than the clear-cut ones.
  const n = e.numbers, v = n.weeks_of_stock ?? 0;
  const borderline = rule.endsWith("stockout") ? v >= n.min_weeks * 0.75
    : rule.endsWith("overstock") ? v <= n.max_weeks * 1.3
    : rule === "high_demand" ? (n.avg_recent / n.demand_baseline - 1) * 100 <= 35 : false;
  const base = P[phase][rule];
  const over = chance(rule === "needs_judgment" ? base : Math.min(0.95, borderline ? base * 1.5 : base * 0.4));

  if (rule === "needs_judgment") {
    if (over) return overrideWith([["new_launch", 5], ["data_wrong", 3], ["competitor_scheme", 2]]);
    return { ...edited(std), ...keep(0.3) };
  }
  if (rule === "perishable_stockout") {
    if (over) return overrideWith(phase === "aug" ? [["season_missed", 72], ["competitor_scheme", 12], ["other", 8], ["data_wrong", 8]] : [["season_missed", 40], ["competitor_scheme", 25], ["data_wrong", 20], ["other", 15]]);
    if (chance(0.1)) return { ...edited(e.recommended_qty ?? std), ...keep(0.2) };
    return { status: "approved", qty: e.recommended_qty, ...keep(0.1) };
  }
  if (rule === "high_demand") {
    if (over) return overrideWith([["competitor_scheme", 5], ["other", 3], ["data_wrong", 2]]);
    if (chance(0.12)) return { ...edited(e.recommended_qty ?? std), ...keep(0.2) };
    return { status: "approved", qty: e.recommended_qty, ...keep(0.1) };
  }
  if (rule === "standard_stockout") {
    if (over) return overrideWith([["competitor_scheme", 4], ["data_wrong", 4], ["other", 2], ["season_missed", 2]]);
    if (chance(0.08)) return { ...edited(e.recommended_qty ?? std), ...keep(0.2) };
    return { status: "approved", qty: e.recommended_qty, ...keep(0.08) };
  }
  // overstock rules: a pause
  if (over) return overrideWith([["season_missed", 5], ["data_wrong", 3], ["competitor_scheme", 2]]);
  return { status: "approved", qty: null, ...keep(0.05) };
}

async function main() {
  const sql = getSql();
  const settings = parseSettings((await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[]);
  const h = await loadHistory(sql);
  const names = new Map<string, number>();

  if (RESET && !DRY) {
    await sql.query("delete from flags where run_id in (select id from runs where note = $1)", [NOTE]);
    await sql.query("delete from runs where note = $1", [NOTE]);
    await sql.query("delete from outcomes");
    await sql.query("delete from suggestions");
    console.log("Reset: seeded history, outcomes and suggestions removed.");
  }

  const lastDecided = new Map<string, string>(); // sku -> date of its last decision, for the 7-day hold-back
  const all: Seeded[] = [];
  const runs: { date: string; n: number }[] = [];
  for (let d = FIRST_RUN; d <= LAST_RUN; d = addDays(d, 1)) {
    const dow = new Date(d + "T00:00:00Z").getUTCDay();
    if (dow !== 1) continue; // Monday
    let n = 0;
    for (const s of h.skus) {
      const last = lastDecided.get(s.sku_id);
      if (last && (Date.parse(d) - Date.parse(last)) / 86400000 < COOLDOWN_DAYS) continue;
      const stockMap = h.stock.get(s.sku_id);
      let stock: number | undefined;
      for (let k = 0; k < 7 && stock === undefined; k++) stock = stockMap?.get(addDays(d, -k));
      const e = evaluateSku({ sku_id: s.sku_id, is_perishable: s.is_perishable, standard_order_qty: s.standard_order_qty, stock: stock ?? 0, sales: h.sales.get(s.sku_id) ?? new Map() }, d, settings);
      if (!e) continue;
      const dec = decide(e, d);
      const hours = 1 + Math.floor(rand() * 6);
      all.push({ runDate: d, e, ...dec, rating: chance(0.35) ? (chance(0.7) ? "up" : "down") : null, createdAt: `${d}T07:00:00+05:30`, decidedAt: `${d}T${String(7 + hours).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00+05:30` });
      lastDecided.set(s.sku_id, d);
      n++;
    }
    runs.push({ date: d, n });
  }

  // Summary
  const by = new Map<string, { n: number; over: number }>();
  const byMonth = new Map<string, { n: number; over: number }>();
  for (const f of all) {
    const key = `${f.runDate.slice(0, 7)} ${ruleOf({ flag_type: f.e.flag_type, window_type: f.e.numbers.window_type }).key}`;
    const a = by.get(key) ?? { n: 0, over: 0 }; a.n++; if (f.status === "overridden") a.over++; by.set(key, a);
    const m = byMonth.get(f.runDate.slice(0, 7)) ?? { n: 0, over: 0 }; m.n++; if (f.status === "overridden") m.over++; byMonth.set(f.runDate.slice(0, 7), m);
  }
  console.log(`${runs.length} runs, ${all.length} flags, ${all.filter((f) => f.status === "overridden").length} overridden (${Math.round((100 * all.filter((f) => f.status === "overridden").length) / all.length)}%)`);
  console.log("flags per run:", runs.map((r) => r.n).join(" "));
  console.log("by month:", [...byMonth].sort().map(([m, a]) => `${m}: ${a.over}/${a.n} (${Math.round((100 * a.over) / a.n)}%)`).join("  "));
  for (const [k, a] of [...by].sort()) console.log(`  ${k.padEnd(34)} ${String(a.over).padStart(3)} overridden of ${a.n}`);
  const k3 = all.filter((f) => f.runDate >= "2026-08-31");
  console.log(`K3 window (decided from 31 Aug, six weeks after go-live ${FIRST_RUN}): ${k3.filter((f) => f.status === "overridden").length} of ${k3.length} overridden = ${Math.round((100 * k3.filter((f) => f.status === "overridden").length) / k3.length)}%`);
  void names;
  if (DRY) return;

  // Write
  const runIds = new Map<string, number>();
  for (const r of runs) {
    const [row] = (await sql.query("insert into runs (trigger, run_date, status, started_at, finished_at, flagged_total, flags_new, flags_refreshed, flags_unchanged, flags_held, ai_reasons, flags_raised, note) values ('cron',$1,'succeeded',$2,$2,$3,$3,0,0,0,0,$3,$4) returning id",
      [r.date, `${r.date}T07:00:00+05:30`, r.n, NOTE])) as { id: number }[];
    runIds.set(r.date, Number(row.id));
  }
  const CHUNK = 100;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((f) => {
      const v = [runIds.get(f.runDate), f.e.sku_id, f.e.flag_type, f.e.also_types, f.e.urgent, f.e.recommended_qty, JSON.stringify(f.e.numbers), templateReason(f.e), "template", null, f.status, f.qty, f.tag, f.text, f.rating, f.decidedAt, f.createdAt];
      return `(${v.map((x) => { params.push(x); return `$${params.length}`; }).join(",")})`;
    });
    await sql.query(`insert into flags (run_id, sku_id, flag_type, also_types, urgent, recommended_qty, numbers, reason, reason_source, reason_fallback, status, final_qty, decision_tag, override_reason, reason_rating, decided_at, created_at) values ${tuples.join(",")}`, params);
  }
  // Demo dates for the kill-criteria panel (Phase 9): the project started in May, the rules went live on the first seeded run.
  await sql.query("update rule_settings set value = $2, updated_at = now() where key = $1", ["go_live_date", JSON.stringify(FIRST_RUN)]);
  await sql.query("update rule_settings set value = $2, updated_at = now() where key = $1", ["project_start_date", JSON.stringify("2026-05-26")]);
  console.log(`Saved ${runs.length} runs and ${all.length} flags. go_live_date = ${FIRST_RUN}, project_start_date = 2026-05-26 (demo values).`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
