import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { geminiFromEnv } from "@/lib/reasons/gemini";
import { startRun } from "@/lib/run/execute";
import { isAuthorizedCron, todayIST } from "@/lib/run/schedule";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Called by Vercel Cron on Monday and Thursday at 07:00 IST (see vercel.json). Vercel sends the CRON_SECRET as a bearer token.
// Anyone else is refused, and if CRON_SECRET is not set the route refuses everyone.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set on the server." }, { status: 500 });
  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  const out = await startRun(getSql(), { trigger: "cron", runDate: todayIST(), gen: geminiFromEnv(), reasonBudgetMs: 35_000 });
  return NextResponse.json(out);
}
