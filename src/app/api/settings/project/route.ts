import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { parseProjectValue, saveProjectSettings } from "@/lib/kill/settings";

// Project dates and kill-criteria thresholds. Validated, written to the change log with a reason.
export async function POST(req: NextRequest) {
  const { changes, reason } = (await req.json().catch(() => ({}))) as { changes?: Record<string, unknown>; reason?: string };
  if (!changes || typeof changes !== "object") return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  const parsed = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, parseProjectValue(k, v)]));
  const r = await saveProjectSettings(getSql(), { changes: parsed, reason: reason ?? "" });
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.errors.join(" ") }, { status: 422 });
}
