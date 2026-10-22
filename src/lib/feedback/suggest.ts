// Turns the decisions Raghav has made into suggestion cards. The cards are only suggestions: nothing here edits a rule.

import type { Sql } from "../db/client";
import { parseSettings } from "../rules/engine";
import type { Tag } from "../review/decide";
import { draftSuggestions, flagValue, ruleOf, type DecidedFlag } from "./analysis";

export async function generateSuggestions(sql: Sql, now: Date = new Date()): Promise<{ created: number; refreshed: number }> {
  const settingRows = (await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[];
  const settings = parseSettings(settingRows);
  const get = (k: string, d: number) => Number(settingRows.find((r) => r.key === k)?.value ?? d);
  const overrideThreshold = get("suggest_override_count", 10), tagThreshold = get("suggest_tag_count", 10);

  const rows = (await sql.query(
    `select f.id, f.flag_type, f.numbers, f.status, f.decision_tag, to_char(f.decided_at at time zone 'Asia/Kolkata', 'YYYY-MM') as month, s.category, o.result as check_result
       from flags f join skus s using (sku_id) left join outcomes o on o.flag_id = f.id and o.kind = 'override_check'
      where f.status <> 'pending' and f.decided_at > $1::timestamptz - interval '100 days'`, [now.toISOString()])) as
    { id: number; flag_type: string; numbers: { window_type: string; triggers?: string[]; weeks_of_stock: number | null; avg_recent: number; demand_baseline: number }; status: DecidedFlag["status"]; decision_tag: Tag | null; month: string; category: string; check_result: DecidedFlag["check"] }[];

  const flags: DecidedFlag[] = rows.map((r) => {
    const rule = ruleOf({ flag_type: r.flag_type, window_type: r.numbers.window_type, triggers: r.numbers.triggers });
    return { id: Number(r.id), rule, value: flagValue(rule, r.numbers), status: r.status, tag: r.decision_tag, month: r.month, category: r.category, check: r.check_result };
  });

  let created = 0, refreshed = 0;
  for (const month of [...new Set(flags.map((f) => f.month))].sort()) {
    for (const d of draftSuggestions(flags, month, { overrideThreshold, tagThreshold, settings })) {
      // A new card, or fresh numbers on a card that is still open. A card Raghav already handled is never recreated or changed.
      const res = (await sql.query(
        `insert into suggestions (rule_key, evidence, text, proposal, dedupe_key) values ($1,$2,$3,$4,$5)
         on conflict (dedupe_key) where dedupe_key is not null do update set evidence = excluded.evidence, text = excluded.text, proposal = excluded.proposal
           where suggestions.status = 'open' returning (xmax = 0) as inserted`,
        [d.rule_key, JSON.stringify(d.evidence), d.text, d.proposal ? JSON.stringify(d.proposal) : null, d.dedupe_key])) as { inserted: boolean }[];
      if (res.length) res[0].inserted ? created++ : refreshed++;
    }
  }
  return { created, refreshed };
}
