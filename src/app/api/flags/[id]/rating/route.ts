import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";

// Thumbs up or down on the AI's reason. Touches nothing but the rating.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const { rating } = (await req.json().catch(() => ({}))) as { rating?: "up" | "down" | null };
  if (!Number.isInteger(id) || ![undefined, null, "up", "down"].includes(rating)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const done = (await getSql().query("update flags set reason_rating = $2 where id = $1 returning id", [id, rating ?? null])) as { id: number }[];
  return done.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Flag not found." }, { status: 404 });
}
