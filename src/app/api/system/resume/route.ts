import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { setPaused } from "@/lib/run/state";

// "Resume system". Needs a typed reason, which is logged. (No app password in this build: that was your decision.)
export async function POST(req: NextRequest) {
  const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
  const r = await setPaused(getSql(), false, reason ?? "");
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
