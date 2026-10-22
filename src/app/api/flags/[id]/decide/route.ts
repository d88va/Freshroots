import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { validateDecision, type DecisionInput, type FlagForDecision } from "@/lib/review/decide";

// Raghav approves, edits or overrides one flag. The same rules the screen uses are applied again here,
// so a needs-judgment flag can never be approved, whatever the browser sends.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad flag id." }, { status: 400 });
  let body: DecisionInput;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  if (!["approve", "edit", "override"].includes(body?.action)) return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  const sql = getSql();
  const [flag] = (await sql.query("select flag_type, recommended_qty, numbers, status from flags where id = $1", [id])) as FlagForDecision[];
  if (!flag) return NextResponse.json({ error: "Flag not found." }, { status: 404 });

  const verdict = validateDecision(flag, body.action === "edit" ? { ...body, qty: Number((body as { qty: unknown }).qty) } : body);
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 422 });

  const done = (await sql.query(
    `update flags set status = $2, final_qty = $3, decision_tag = $4, override_reason = $5, decided_at = now()
      where id = $1 and status = 'pending' returning id`,
    [id, verdict.status, verdict.final_qty, verdict.tag, verdict.text])) as { id: number }[];
  if (!done.length) return NextResponse.json({ error: "This flag was already decided." }, { status: 409 });
  return NextResponse.json({ ok: true, status: verdict.status });
}
