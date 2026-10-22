import type { Sql } from "../db/client";
import { loadHistory } from "../db/history";
import { parseSettings } from "../rules/engine";
import { replay, type BtSummary } from "./replay";

/** Runs the backtest with the CURRENT saved rules and stores the result. */
export async function runBacktest(sql: Sql): Promise<BtSummary> {
  const rows = (await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[];
  const settings = parseSettings(rows);
  const get = (k: string) => Number(rows.find((r) => r.key === k)?.value);
  const params = { lookback_weeks: get("backtest_lookback_weeks"), min_lead_weeks: get("backtest_min_lead_weeks") };
  const history = await loadHistory(sql);
  const summary = replay({ ...history, settings, params });
  await sql.query("insert into backtest_results (params, summary) values ($1, $2)", [JSON.stringify({ params, settings }), JSON.stringify(summary)]);
  return summary;
}
