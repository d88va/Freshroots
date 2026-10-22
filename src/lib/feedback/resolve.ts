// Raghav's three answers to a suggestion. Accept and edit save a new rule version (with his reason) and mark the
// suggestion resolved in ONE atomic step. Dismiss changes nothing but the card. The system never calls these itself.

import type { Sql } from "../db/client";
import { saveRuleChange } from "../rules/settings";

export type ResolveResult = { ok: true; versionId?: number } | { ok: false; error: string; status: number };

async function open(sql: Sql, id: number) {
  const [s] = (await sql.query("select id, status, rule_key, proposal from suggestions where id = $1", [id])) as { id: number; status: string; rule_key: string; proposal: { key: string; to: unknown } | null }[];
  return s;
}

export async function acceptSuggestion(sql: Sql, id: number, reason: string): Promise<ResolveResult> {
  const s = await open(sql, id);
  if (!s) return { ok: false, error: "Suggestion not found.", status: 404 };
  if (s.status !== "open") return { ok: false, error: "This suggestion was already handled.", status: 409 };
  if (!s.proposal) return { ok: false, error: "This suggestion has no specific change to accept. Use Edit to choose one, or Dismiss.", status: 422 };
  return save(sql, id, "accepted", { [s.proposal.key]: s.proposal.to }, reason);
}

export async function editSuggestion(sql: Sql, id: number, key: string, value: unknown, reason: string): Promise<ResolveResult> {
  const s = await open(sql, id);
  if (!s) return { ok: false, error: "Suggestion not found.", status: 404 };
  if (s.status !== "open") return { ok: false, error: "This suggestion was already handled.", status: 409 };
  return save(sql, id, "edited", { [key]: value }, reason);
}

export async function dismissSuggestion(sql: Sql, id: number, reason: string): Promise<ResolveResult> {
  const done = (await sql.query(
    `update suggestions set status = 'dismissed', resolved_at = now(), resolution = jsonb_build_object('reason', $2::text)
      where id = $1 and status = 'open' returning id`, [id, reason.trim()])) as { id: number }[];
  return done.length ? { ok: true } : { ok: false, error: "This suggestion was already handled or does not exist.", status: 409 };
}

async function save(sql: Sql, id: number, status: "accepted" | "edited", changes: Record<string, unknown>, reason: string): Promise<ResolveResult> {
  const r = await saveRuleChange(sql, {
    changes, reason,
    alsoInTransaction: () => [sql.query(
      `update suggestions set status = $2, resolved_at = now(),
              resolution = jsonb_build_object('reason', $3::text, 'version_id', (select max(id) from rule_versions), 'changes', $4::jsonb)
        where id = $1 and status = 'open'`, [id, status, reason.trim(), JSON.stringify(changes)])],
  });
  return r.ok ? { ok: true, versionId: r.versionId } : { ok: false, error: r.errors.join(" "), status: 422 };
}
