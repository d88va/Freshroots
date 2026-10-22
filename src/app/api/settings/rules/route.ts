import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { parseSettingValue, saveRuleChange } from "@/lib/rules/settings";

// Raghav edits rule thresholds. Validated, saved as a new rule version with his reason, used from the next run.
export async function POST(req: NextRequest) {
  const { changes, reason } = (await req.json().catch(() => ({}))) as { changes?: Record<string, unknown>; reason?: string };
  if (!changes || typeof changes !== "object") return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  const parsed = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, parseSettingValue(k, v)]));
  const r = await saveRuleChange(getSql(), { changes: parsed, reason: reason ?? "" });
  return r.ok ? NextResponse.json({ ok: true, versionId: r.versionId }) : NextResponse.json({ error: r.errors.join(" ") }, { status: 422 });
}
