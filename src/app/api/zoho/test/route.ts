import { NextResponse } from "next/server";
import { createZohoClient, zohoFromEnv } from "@/lib/zoho/client";

export const maxDuration = 30;

// "Test connection": signs in and reads the organisation's name. Changes nothing in Zoho.
export async function POST() {
  const cfg = zohoFromEnv();
  if (!cfg) return NextResponse.json({ error: "Zoho is not connected. Set the ZOHO_ values and redeploy." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await createZohoClient(cfg).ping()) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
