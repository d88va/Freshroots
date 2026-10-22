import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { validateEvent } from "@/lib/season/events";

// Add an event. Events are context only: they change no number and no flag.
export async function POST(req: NextRequest) {
  const v = validateEvent(await req.json().catch(() => ({})));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 422 });
  const { kind, name, start_date, end_date, note } = v.value;
  try {
    const [row] = (await getSql().query("insert into calendar_events (kind, name, start_date, end_date, note, logged_by) values ($1,$2,$3,$4,$5,'raghav') returning id", [kind, name, start_date, end_date, note])) as { id: number }[];
    return NextResponse.json({ ok: true, id: Number(row.id) });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return NextResponse.json({ error: "An event with this kind, name and start date already exists." }, { status: 409 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
