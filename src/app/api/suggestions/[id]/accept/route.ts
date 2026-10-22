import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { acceptSuggestion } from "@/lib/feedback/resolve";

// Raghav accepts a suggestion: its proposed change becomes a new rule version, saved with his reason. Only he can call this.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad suggestion id." }, { status: 400 });
  const r = await acceptSuggestion(getSql(), id, reason ?? "");
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status });
}
