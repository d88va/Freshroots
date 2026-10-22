import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { runOutcomeCheck } from "@/lib/feedback/outcomes";
import { generateSuggestions } from "@/lib/feedback/suggest";
import { isPaused } from "@/lib/run/state";
import { isAuthorizedCron } from "@/lib/run/schedule";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Daily at 07:30 IST (vercel.json). Records outcomes for decisions that are 28+ days old, then drafts suggestions.
// Writes facts and suggestion cards only. It changes no rule and no flag. Blocked while the system is paused.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set on the server." }, { status: 500 });
  if (!isAuthorizedCron(req.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  const sql = getSql();
  if (await isPaused(sql)) return NextResponse.json({ blocked: "The system is paused." });
  const outcomes = await runOutcomeCheck(sql);
  const suggestions = await generateSuggestions(sql);
  return NextResponse.json({ outcomes, suggestions });
}
