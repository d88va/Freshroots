// Puts the system back into a clean state for a demo.   npm run demo:reset            (shows what it would do)
//                                                       npm run demo:reset -- --yes   (does it)
//
// It REMOVES: every run and flag made since the seeded demo history (so the decisions, orders and runs from earlier
// click-throughs go), and every suggestion (they are regenerated). It KEEPS: the seeded history (July to September),
// all data, the settings, and the rule and setting change logs. It then restores the documented default rules,
// resumes the system if it was paused, sets the run date, runs the rules, and rebuilds the suggestions.
// Only for the demo database. Never run it against real data.
import { getSql } from "../src/lib/db/client";
import { DEFAULT_SETTINGS, parseSettings } from "../src/lib/rules/engine";
import { saveRuleChange } from "../src/lib/rules/settings";
import { saveProjectSettings } from "../src/lib/kill/settings";
import { setPaused } from "../src/lib/run/state";
import { startRun } from "../src/lib/run/execute";
import { geminiFromEnv } from "../src/lib/reasons/gemini";
import { runOutcomeCheck } from "../src/lib/feedback/outcomes";
import { generateSuggestions } from "../src/lib/feedback/suggest";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const YES = process.argv.includes("--yes");
const AS_OF = arg("as-of", "2026-10-22");
const SEEDED = "Demo history (seeded)";

async function main() {
  const sql = getSql();
  const one = async (q: string, p: unknown[] = []) => Number(((await sql.query(q, p)) as { n: number }[])[0].n);
  const runs = await one("select count(*)::int as n from runs where note is distinct from $1", [SEEDED]);
  const flags = await one("select count(*)::int as n from flags where run_id in (select id from runs where note is distinct from $1)", [SEEDED]);
  const decided = await one("select count(*)::int as n from flags where status <> 'pending' and run_id in (select id from runs where note is distinct from $1)", [SEEDED]);
  const sugg = await one("select count(*)::int as n from suggestions");
  const current = parseSettings((await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[]);
  const drift = Object.entries(DEFAULT_SETTINGS).filter(([k, v]) => JSON.stringify((current as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)).map(([k]) => k);
  const paused = (await sql.query("select paused from system_state where id = 1") as { paused: boolean }[])[0].paused;

  console.log("Target database state:");
  console.log(`  runs to remove: ${runs} (with ${flags} flags, ${decided} of them already decided)`);
  console.log(`  suggestions to remove and rebuild: ${sugg}`);
  console.log(`  rules that differ from the documented defaults: ${drift.length ? drift.join(", ") : "none"}`);
  console.log(`  system paused: ${paused}`);
  console.log(`  run date will be set to ${AS_OF}`);
  if (!YES) { console.log("\nNothing was changed. Run again with --yes to do it."); return; }

  if (paused) await setPaused(sql, false, "Demo reset: resumed the system");
  if (drift.length) {
    const r = await saveRuleChange(sql, { changes: Object.fromEntries(drift.map((k) => [k, (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k]])), reason: "Demo reset: restored the documented default rules", by: "demo-reset" });
    console.log(r.ok ? `Restored default rules as version ${r.versionId}.` : `Could not restore rules: ${r.errors.join(" ")}`);
  }
  const asOf = (await sql.query("select value from rule_settings where key = 'run_date_override'") as { value: unknown }[])[0]?.value;
  if (asOf !== AS_OF) {
    const r = await saveProjectSettings(sql, { changes: { run_date_override: AS_OF }, reason: "Demo reset: the synthetic data ends in October 2026, so runs use this date as today", by: "demo-reset" });
    console.log(r.ok ? `Run date set to ${AS_OF}.` : `Could not set the run date: ${r.errors.join(" ")}`);
  }

  await sql.query("delete from runs where note is distinct from $1", [SEEDED]); // flags, reasons and outcomes for them go too
  await sql.query("delete from suggestions");
  console.log("Removed the earlier runs, flags and suggestions.");

  console.log("Running the rules (AI reasons go to the most urgent flags first, within today's Gemini allowance)...");
  const out = await startRun(sql, { trigger: "manual", runDate: AS_OF, gen: geminiFromEnv(), reasonBudgetMs: Number(arg("budget", "120")) * 1000 });
  if (out.kind === "done") {
    const s = out.summary;
    console.log(`Run ${s.run_id}: ${s.flagged_total} SKUs flagged, ${s.new} new pending flags, ${s.reasons.ai} AI reasons written, ${s.reasons.waiting} waiting for the AI allowance.`);
  } else console.log(`The run did not start: ${out.reason}`);

  const o = await runOutcomeCheck(sql);
  const g = await generateSuggestions(sql);
  console.log(`Outcome check: ${o.override_checks + o.end_states} new outcomes. Suggestions rebuilt: ${g.created}.`);
  console.log("\nDemo state is ready.");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
