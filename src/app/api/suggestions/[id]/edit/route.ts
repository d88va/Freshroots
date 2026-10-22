import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { editSuggestion } from "@/lib/feedback/resolve";
import { parseSettingValue } from "@/lib/rules/settings";

// Raghav chooses his own value instead of the proposal. It becomes a new rule version with his reason.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const body = (await req.json().catch(() => ({}))) as { key?: string; value?: unknown; reason?: string };
  if (!Number.isInteger(id) || !body.key) return NextResponse.json({ error: "Choose a setting and a value." }, { status: 400 });
  const r = await editSuggestion(getSql(), id, body.key, parseSettingValue(body.key, body.value), body.reason ?? "");
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status });
}
