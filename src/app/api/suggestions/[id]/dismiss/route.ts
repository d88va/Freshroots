import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { dismissSuggestion } from "@/lib/feedback/resolve";

// Raghav dismisses a suggestion. Nothing changes except the card.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad suggestion id." }, { status: 400 });
  const r = await dismissSuggestion(getSql(), id, reason ?? "");
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status });
}
