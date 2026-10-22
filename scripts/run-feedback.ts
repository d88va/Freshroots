// The outcome check and suggestion generation, the same code as the daily cron job and the button.   npm run feedback:check
import { getSql } from "../src/lib/db/client";
import { runOutcomeCheck } from "../src/lib/feedback/outcomes";
import { generateSuggestions } from "../src/lib/feedback/suggest";

async function main() {
  const sql = getSql();
  const t = Date.now();
  console.log("outcomes:", await runOutcomeCheck(sql));
  console.log("suggestions:", await generateSuggestions(sql));
  console.log(`done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
