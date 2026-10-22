import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { geminiFromEnv } from "@/lib/reasons/gemini";
import { startRun } from "@/lib/run/execute";
import { asOfDate } from "@/lib/run/state";

export const maxDuration = 60;

// The "Run now" button. Same code as the cron job. Blocked while the system is paused.
export async function POST() {
  try {
    const out = await startRun(getSql(), { trigger: "manual", runDate: await asOfDate(getSql()), gen: geminiFromEnv(), reasonBudgetMs: 35_000 });
    if (out.kind === "blocked") return NextResponse.json({ error: out.reason }, { status: 423 });
    if (out.kind === "skipped") return NextResponse.json({ error: out.reason }, { status: 409 });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
