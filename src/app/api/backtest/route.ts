import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { runBacktest } from "@/lib/backtest/run";

export const maxDuration = 60;

// Re-runs the replay with the rules saved right now and stores the result. Changes no rules and no flags.
export async function POST() {
  try {
    const summary = await runBacktest(getSql());
    return NextResponse.json({ ok: true, caught_pct: summary.caught_pct });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
