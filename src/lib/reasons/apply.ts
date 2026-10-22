// Writes reasons onto flags in Neon. This is the only place reasons touch the database, and it only
// ever updates reason, reason_source and reason_fallback. It never touches flag_type, quantity or numbers.

import type { Sql } from "../db/client";
import type { Evaluation } from "../rules/engine";
import { makeReason } from "./index";
import { templateReason } from "./template";
import type { TextGenerator } from "./gemini";

interface FlagRow {
  id: number; flag_type: Evaluation["flag_type"]; also_types: Evaluation["also_types"]; urgent: boolean;
  recommended_qty: number | null; numbers: Evaluation["numbers"]; reason: string | null; name: string; is_perishable: boolean; sku_id: string;
}

// A template flag with one of these reasons is worth another try with the AI. A rejected sentence is not retried.
const RETRYABLE = ["not_yet", "no_key", "api_error", "rate_limited", "timeout"];
const toEvaluation = (f: FlagRow): Evaluation => ({ sku_id: f.sku_id, flag_type: f.flag_type, also_types: f.also_types, urgent: f.urgent, recommended_qty: f.recommended_qty, numbers: f.numbers });

export interface FillSummary { total: number; ai: number; template: number; waiting: number }

/**
 * Gives every pending flag a reason. Step 1 puts a template reason on all of them straight away, so
 * Raghav never sees an empty reason. Step 2 asks the AI, one flag at a time, until the time budget runs out;
 * flags it did not reach keep their template and are picked up next time.
 */
export async function fillReasons(sql: Sql, opts: { gen: TextGenerator | null; budgetMs: number; flagIds?: number[]; model?: string }): Promise<FillSummary> {
  const deadline = Date.now() + opts.budgetMs;
  const filter = opts.flagIds ? "and f.id = any($1::bigint[])" : "";
  const rows = (await sql.query(
    `select f.id, f.sku_id, f.flag_type, f.also_types, f.urgent, f.recommended_qty, f.numbers, f.reason, f.reason_source, f.reason_fallback, s.name, s.is_perishable
       from flags f join skus s using (sku_id)
      where f.status = 'pending' ${filter}
        and (f.reason is null or f.reason_source = 'template')
      order by f.urgent desc, f.id`, opts.flagIds ? [opts.flagIds] : [])) as (FlagRow & { reason_source: string | null; reason_fallback: string | null })[];

  // Step 1: a template on everything that has no reason yet
  for (const f of rows.filter((r) => r.reason === null)) {
    await sql.query("update flags set reason = $1, reason_source = 'template', reason_fallback = $2 where id = $3", [templateReason(toEvaluation(f)), opts.gen ? "not_yet" : "no_key", f.id]);
  }

  // Step 2: ask the AI, within the budget
  let ai = 0, template = 0, waiting = 0, limited = 0;
  for (const f of rows) {
    if (f.reason !== null && f.reason_fallback && !RETRYABLE.includes(f.reason_fallback)) { template++; continue; }
    // Two rate-limit answers in a row means the quota is used up: stop asking, the rest keep their template for now.
    if (!opts.gen || Date.now() >= deadline || limited >= 2) { waiting++; continue; }
    const r = await makeReason({ evaluation: toEvaluation(f), sku_name: f.name, is_perishable: f.is_perishable }, opts.gen, deadline);
    await sql.query("update flags set reason = $1, reason_source = $2, reason_fallback = $3 where id = $4", [r.reason, r.source, r.fallback, f.id]);
    await sql.query("insert into reason_attempts (flag_id, outcome, model, latency_ms, ai_text, detail) values ($1,$2,$3,$4,$5,$6)",
      [f.id, r.source === "ai" ? "accepted" : r.fallback, opts.model ?? null, r.latency_ms, r.ai_text, r.detail]);
    limited = r.fallback === "rate_limited" ? limited + 1 : 0;
    if (r.source === "ai") ai++; else template++;
  }
  return { total: rows.length, ai, template, waiting };
}
