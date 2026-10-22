import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { setPaused } from "@/lib/run/state";

// "Pause system". Done by hand, with a reason, and logged. The system never calls this itself, even when K3 is red.
export async function POST(req: NextRequest) {
  const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
  const r = await setPaused(getSql(), true, reason ?? "");
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
