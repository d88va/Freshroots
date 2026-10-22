import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { validateEvent } from "@/lib/season/events";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad event id." }, { status: 400 });
  const v = validateEvent(await req.json().catch(() => ({})));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 422 });
  const { kind, name, start_date, end_date, note } = v.value;
  try {
    const done = (await getSql().query("update calendar_events set kind = $2, name = $3, start_date = $4, end_date = $5, note = $6 where id = $1 returning id", [id, kind, name, start_date, end_date, note])) as { id: number }[];
    return done.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Event not found." }, { status: 404 });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return NextResponse.json({ error: "An event with this kind, name and start date already exists." }, { status: 409 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad event id." }, { status: 400 });
  const done = (await getSql().query("delete from calendar_events where id = $1 returning id", [id])) as { id: number }[];
  return done.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Event not found." }, { status: 404 });
}
