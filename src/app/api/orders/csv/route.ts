import { getSql } from "@/lib/db/client";
import { ordersList } from "@/lib/review/data";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// Approved orders only. Stands in for the Zoho purchase-order import: this build does not talk to Zoho.
export async function GET() {
  const rows = await ordersList(getSql());
  const header = ["sku_id", "sku_name", "quantity", "decision", "approved_at", "flag_type", "reason_tag", "status"];
  const lines = rows.map((r) => [r.sku_id, r.name, r.final_qty, r.status, new Date(r.decided_at as string).toISOString(), r.flag_type, r.decision_tag ?? "", "sent to Zoho (mock)"].map(esc).join(","));
  return new Response([header.join(","), ...lines].join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="freshroots-orders-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
