import { getSql } from "@/lib/db/client";
import { ordersList } from "@/lib/review/data";
import { getPoLines } from "@/lib/po/data";
import { isPoDate, poNumberForDate } from "@/lib/po/format";
import { zohoFromEnv } from "@/lib/zoho/client";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// Approved orders only. By default the last 14 days; add ?all=1 for everything. Stands in for the Zoho purchase-order import: this build does not talk to Zoho.
export async function GET(req: Request) {
  const url = new URL(req.url);

  // One purchase order (one day's approved orders): ?po=2026-10-23
  const po = url.searchParams.get("po");
  if (po !== null) {
    if (!isPoDate(po)) return new Response("Not a valid purchase order date.", { status: 400 });
    const lines = await getPoLines(getSql(), po);
    if (!lines.length) return new Response("Purchase order not found.", { status: 404 });
    const number = poNumberForDate(po);
    const head = ["po_number", "line", "sku_id", "sku_name", "category", "quantity", "unit", "decision", "reason_tag", "zoho"];
    const rowsCsv = lines.map((l, i) => [number, i + 1, l.sku_id, l.name, l.category, l.quantity, "units", l.status, l.decision_tag ?? "", "sent to Zoho (mock)"].map(esc).join(","));
    return new Response([head.join(","), ...rowsCsv].join("\n") + "\n", {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${number}.csv"` },
    });
  }

  const all = url.searchParams.get("all") === "1";
  const q = (url.searchParams.get("q") ?? "").slice(0, 60);
  const sql = getSql();
  const rows = await ordersList(sql, all, q);
  const live = zohoFromEnv() !== null;
  const sync = new Map<number, string>();
  if (live && rows.length) for (const r of (await sql.query("select flag_id, status, po_number from zoho_sync where flag_id = any($1::bigint[])", [rows.map((o) => o.id)])) as { flag_id: number; status: string; po_number: string | null }[]) sync.set(Number(r.flag_id), r.status === "sent" ? `draft ${r.po_number} in Zoho` : r.status);
  const header = ["sku_id", "sku_name", "quantity", "decision", "approved_at", "flag_type", "reason_tag", "status"];
  const lines = rows.map((r) => [r.sku_id, r.name, r.final_qty, r.status, new Date(r.decided_at as string).toISOString(), r.flag_type, r.decision_tag ?? "", live ? (sync.get(r.id) ?? "not sent to Zoho") : "sent to Zoho (mock)"].map(esc).join(","));
  return new Response([header.join(","), ...lines].join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="freshroots-orders-${all ? "all-" : ""}${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
