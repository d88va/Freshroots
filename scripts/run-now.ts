// Runs the rules on today's data and saves the flags. Reasons come from Gemini within the time budget.
//   npm run run:now -- [--budget 120] [--date 2026-10-22]
import { getSql } from "../src/lib/db/client";
import { executeRun } from "../src/lib/run/execute";
import { geminiFromEnv } from "../src/lib/reasons/gemini";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };

async function main() {
  const runDate = arg("date", new Date().toISOString().slice(0, 10));
  const budget = Number(arg("budget", "120")) * 1000;
  console.log(`Running on ${runDate}, reasons budget ${budget / 1000}s ...`);
  const s = await executeRun(getSql(), { trigger: "manual", runDate, gen: geminiFromEnv(), reasonBudgetMs: budget });
  console.log(JSON.stringify(s, null, 1));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
