// Runs the rules on today's data and saves the flags.   npm run run:now -- [--budget 120] [--date 2026-10-22]
// Same code as the Run now button and the cron job. Respects the Pause switch.
import { getSql } from "../src/lib/db/client";
import { startRun } from "../src/lib/run/execute";
import { asOfDate } from "../src/lib/run/state";
import { geminiFromEnv } from "../src/lib/reasons/gemini";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };

async function main() {
  const runDate = arg("date", await asOfDate(getSql()));
  const budget = Number(arg("budget", "120")) * 1000;
  console.log(`Running on ${runDate}, reasons budget ${budget / 1000}s ...`);
  console.log(JSON.stringify(await startRun(getSql(), { trigger: "manual", runDate, gen: geminiFromEnv(), reasonBudgetMs: budget }), null, 1));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
