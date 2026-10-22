// Runs the backtest and prints the headline.   npm run backtest
import { getSql } from "../src/lib/db/client";
import { runBacktest } from "../src/lib/backtest/run";

async function main() {
  const t = Date.now();
  const s = await runBacktest(getSql());
  const { examples, by_year, ...rest } = s;
  console.log(`Done in ${((Date.now() - t) / 1000).toFixed(1)}s.`);
  console.log(JSON.stringify(rest, null, 1));
  console.log("by year:", Object.entries(by_year).map(([y, g]) => `${y}: ${g.caught}/${g.events}`).join("  "));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
