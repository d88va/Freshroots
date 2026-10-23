import { getSql } from "@/lib/db/client";
import { ordersList } from "@/lib/review/data";
import { zohoFromEnv } from "@/lib/zoho/client";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// Approved orders only. By default the last 14 days; add ?all=1 for everything. Stands in for the Zoho purchase-order import: this build does not talk to Zoho.
export async function GET(req: Request) {
  const all = new URL(req.url).searchParams.get("all") === "1";
  const sql = getSql();
  const rows = await ordersList(sql, all);
  const live = zohoFromEnv() !== null;
  const sync = new Map<number, string>();
  if (live && rows.length) for (const r of (await sql.query("select flag_id, status, po_number from zoho_sync where flag_id = any($1::bigint[])", [rows.map((o) => o.id)])) as { flag_id: number; status: string; po_number: string | null }[]) sync.set(Number(r.flag_id), r.status === "sent" ? `draft ${r.po_number} in Zoho` : r.status);
  const header = ["sku_id", "sku_name", "quantity", "decision", "approved_at", "flag_type", "reason_tag", "status"];
  const lines = rows.map((r) => [r.sku_id, r.name, r.final_qty, r.status, new Date(r.decided_at as string).toISOString(), r.flag_type, r.decision_tag ?? "", live ? (sync.get(r.id) ?? "not sent to Zoho") : "sent to Zoho (mock)"].map(esc).join(","));
  return new Response([header.join(","), ...lines].join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="freshroots-orders-${all ? "all-" : ""}${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
