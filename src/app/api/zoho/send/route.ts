import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { createZohoClient, zohoFromEnv } from "@/lib/zoho/client";
import { sendOrdersToZoho } from "@/lib/zoho/send";
import { isPaused } from "@/lib/run/state";

export const maxDuration = 60;

// "Send to Zoho as drafts". Creates ONE draft purchase order from orders Raghav approved in the last 14 days and has not sent yet.
// It never issues the purchase order. Blocked while the system is paused, and when Zoho is not connected (mock mode).
export async function POST() {
  const cfg = zohoFromEnv();
  if (!cfg) return NextResponse.json({ error: "Zoho is not connected. The app is in mock mode." }, { status: 400 });
  const sql = getSql();
  if (await isPaused(sql)) return NextResponse.json({ error: "The system is paused." }, { status: 423 });
  try {
    return NextResponse.json(await sendOrdersToZoho(sql, createZohoClient(cfg), cfg));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
