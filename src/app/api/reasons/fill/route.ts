import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { fillReasons } from "@/lib/reasons/apply";
import { geminiFromEnv } from "@/lib/reasons/gemini";

export const maxDuration = 60;

// "Write AI reasons": asks Gemini for the pending flags that still have a template, within the daily allowance.
export async function POST() {
  try {
    return NextResponse.json(await fillReasons(getSql(), { gen: geminiFromEnv(), budgetMs: 40_000, model: process.env.GEMINI_MODEL || "gemini-3.5-flash" }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
