import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";

// "Approve all". Approves exactly the flags Raghav saw in the confirm dialog, and ONLY those that are still pending
// and do not need his own judgment. Needs-judgment flags and conflicts are filtered out here, in the query itself.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  if (!ids.length || !ids.every((x) => Number.isInteger(x))) return NextResponse.json({ error: "No flags to approve." }, { status: 400 });
  const done = (await getSql().query(
    `update flags set status = 'approved', final_qty = recommended_qty, decided_at = now()
      where id = any($1::bigint[]) and status = 'pending'
        and flag_type <> 'needs_judgment' and coalesce((numbers->>'conflict')::boolean, false) = false
      returning id`, [ids])) as { id: number }[];
  return NextResponse.json({ ok: true, approved: done.length, skipped: ids.length - done.length });
}
