import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { runOutcomeCheck } from "@/lib/feedback/outcomes";
import { generateSuggestions } from "@/lib/feedback/suggest";
import { isPaused } from "@/lib/run/state";

export const maxDuration = 60;

// "Run outcome check now": the same work as the daily job. Blocked while the system is paused.
export async function POST() {
  try {
    const sql = getSql();
    if (await isPaused(sql)) return NextResponse.json({ error: "The system is paused." }, { status: 423 });
    const outcomes = await runOutcomeCheck(sql);
    const suggestions = await generateSuggestions(sql);
    return NextResponse.json({ outcomes, suggestions });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
