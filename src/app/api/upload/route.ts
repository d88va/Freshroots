import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { loadCsv } from "@/lib/db/load";
import { FILE_KINDS, type FileKind } from "@/lib/csv/adapter";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const kind = String(form.get("kind") ?? "") as FileKind;
  const file = form.get("file");
  if (!FILE_KINDS.some((k) => k.kind === kind)) return NextResponse.json({ error: "Unknown file type." }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a CSV file first." }, { status: 400 });
  try {
    const summary = await loadCsv(getSql(), kind, await file.text(), file.name);
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
