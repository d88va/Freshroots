// One run: read the data, apply the rules to every SKU, save the flags, then add reasons.
// The rules engine decides every flag and number. Reasons are added afterwards and cannot change them.
//
// A run does nothing at all while the system is paused, and never overlaps another run.

import type { Sql } from "../db/client";
import { loadForRun } from "../db/history";
import { evaluateAll, parseSettings, type SkuInput } from "../rules/engine";
import { fillReasons, type FillSummary } from "../reasons/apply";
import type { TextGenerator } from "../reasons/gemini";
import { templateReason } from "../reasons/template";
import { planRun, type PendingFlag } from "./plan";

export interface RunSummary {
  run_id: number;
  run_date: string;
  flagged_total: number; // SKUs the rules flagged
  new: number; // new pending flags
  refreshed: number; // pending flags updated in place because their numbers changed
  unchanged: number; // pending flags that were already up to date
  held: number; // flagged by the rules but decided in the last few days, so not flagged again yet
  no_longer_flagged: number; // still pending, but the rules no longer flag them (left for Raghav)
  reasons: FillSummary;
}

export type RunOutcome =
  | { kind: "done"; summary: RunSummary }
  | { kind: "blocked"; run_id: number; reason: string }
  | { kind: "skipped"; run_id: number; reason: string };

export interface RunOptions { trigger: "cron" | "manual" | "upload"; runDate: string; gen: TextGenerator | null; reasonBudgetMs: number }

export async function startRun(sql: Sql, o: RunOptions): Promise<RunOutcome> {
  // 1. Paused? Then nothing runs, and the attempt is written down.
  const [state] = (await sql.query("select paused from system_state where id = 1")) as { paused: boolean }[];
  if (state?.paused) {
    const [r] = (await sql.query("insert into runs (trigger, run_date, status, finished_at, note) values ($1,$2,'blocked',now(),'System is paused. Nothing was run.') returning id", [o.trigger, o.runDate])) as { id: number }[];
    return { kind: "blocked", run_id: Number(r.id), reason: "The system is paused." };
  }

  // 2. Take the lock and start, in one statement: no other run may be in progress (a stuck one is ignored after 10 minutes).
  const started = (await sql.query(
    `insert into runs (trigger, run_date) select $1, $2
      where not exists (select 1 from runs where status = 'running' and started_at > now() - interval '10 minutes') returning id`, [o.trigger, o.runDate])) as { id: number }[];
  if (!started.length) {
    const [r] = (await sql.query("insert into runs (trigger, run_date, status, finished_at, note) values ($1,$2,'skipped',now(),'Another run was already in progress.') returning id", [o.trigger, o.runDate])) as { id: number }[];
    return { kind: "skipped", run_id: Number(r.id), reason: "Another run is already in progress." };
  }
  const runId = Number(started[0].id);

  try {
    const settingRows = (await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[];
    const settings = parseSettings(settingRows);
    const cooldownDays = Number(settingRows.find((r) => r.key === "reflag_cooldown_days")?.value ?? 0);

    const h = await loadForRun(sql, o.runDate);
    const inputs: SkuInput[] = h.skus.map((s) => ({ sku_id: s.sku_id, is_perishable: s.is_perishable, standard_order_qty: s.standard_order_qty, stock: h.stock.get(s.sku_id) ?? 0, sales: h.sales.get(s.sku_id) ?? new Map() }));
    const evals = evaluateAll(inputs, o.runDate, settings);

    const pending = ((await sql.query("select id, sku_id, flag_type, also_types, urgent, recommended_qty, numbers from flags where status = 'pending'")) as PendingFlag[]).map((p) => ({ ...p, id: Number(p.id) }));
    const decided = cooldownDays > 0
      ? ((await sql.query("select distinct sku_id from flags where status <> 'pending' and decided_at > now() - make_interval(days => $1)", [cooldownDays])) as { sku_id: string }[]).map((r) => r.sku_id)
      : [];
    const plan = planRun(evals, pending, new Set(decided));
    const fallback = o.gen ? "not_yet" : "no_key";

    let created = 0;
    for (const e of plan.insert) {
      const res = (await sql.query(
        `insert into flags (run_id, sku_id, flag_type, also_types, urgent, recommended_qty, numbers, reason, reason_source, reason_fallback)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'template',$9)
         on conflict (sku_id) where status = 'pending' do nothing returning id`,
        [runId, e.sku_id, e.flag_type, e.also_types, e.urgent, e.recommended_qty, JSON.stringify(e.numbers), templateReason(e), fallback])) as { id: number }[];
      created += res.length; // 0 here means another run slipped in a pending flag first: the database refused the duplicate
    }
    for (const { flagId, evaluation: e } of plan.refresh) {
      await sql.query(
        `update flags set run_id = $2, flag_type = $3, also_types = $4, urgent = $5, recommended_qty = $6, numbers = $7,
                reason = $8, reason_source = 'template', reason_fallback = $9, reason_rating = null
          where id = $1 and status = 'pending'`,
        [flagId, runId, e.flag_type, e.also_types, e.urgent, e.recommended_qty, JSON.stringify(e.numbers), templateReason(e), fallback]);
    }

    const reasons = await fillReasons(sql, { gen: o.gen, budgetMs: o.reasonBudgetMs });
    const note = plan.noLongerFlagged.length ? `${plan.noLongerFlagged.length} pending flag(s) are no longer flagged by the rules and were left for Raghav to decide.` : null;
    await sql.query(
      `update runs set status = 'succeeded', finished_at = now(), flags_raised = $2, flagged_total = $3, flags_new = $2, flags_refreshed = $4,
              flags_unchanged = $5, flags_held = $6, ai_reasons = $7, note = $8 where id = $1`,
      [runId, created, evals.length, plan.refresh.length, plan.unchanged, plan.held, reasons.ai, note]);
    return { kind: "done", summary: { run_id: runId, run_date: o.runDate, flagged_total: evals.length, new: created, refreshed: plan.refresh.length, unchanged: plan.unchanged, held: plan.held, no_longer_flagged: plan.noLongerFlagged.length, reasons } };
  } catch (e) {
    await sql.query("update runs set status = 'failed', finished_at = now(), error = $2 where id = $1", [runId, (e as Error).message]);
    throw e;
  }
}
