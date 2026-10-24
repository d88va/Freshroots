import Link from "next/link";
import { getSql } from "@/lib/db/client";
import { RECENT_DAYS, orderTotals, ordersList, pausesList } from "@/lib/review/data";
import { zohoFromEnv } from "@/lib/zoho/client";
import { SEND_CAP, unsentCount } from "@/lib/zoho/send";
import ZohoSend from "./ZohoSend";
import { TAG_LABELS, type Tag } from "@/lib/review/decide";

export const dynamic = "force-dynamic";

const when = (d: unknown) => new Date(d as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function Orders({ searchParams }: { searchParams: Promise<{ all?: string; q?: string }> }) {
  const sp = await searchParams;
  const all = sp.all === "1";
  const q = (sp.q ?? "").slice(0, 60);
  const sql = getSql();
  const [orders, pauses, totals] = await Promise.all([ordersList(sql, all, q), pausesList(sql, all), orderTotals(sql)]);
  const hidden = totals.all - totals.recent;
  const live = zohoFromEnv() !== null;
  const unsent = live ? await unsentCount(sql) : 0;
  const sync = new Map<number, { status: string; po_number: string | null; error: string | null }>();
  if (live && orders.length) {
    for (const r of (await sql.query("select flag_id, status, po_number, error from zoho_sync where flag_id = any($1::bigint[])", [orders.map((o) => o.id)])) as { flag_id: number; status: string; po_number: string | null; error: string | null }[]) sync.set(Number(r.flag_id), r);
  }
  const zohoCell = (id: number) => {
    if (!live) return <span className="pill good">sent to Zoho (mock)</span>;
    const z = sync.get(id);
    if (z?.status === "sent") return <span className="pill good">Draft {z.po_number} in Zoho</span>;
    if (z?.status === "failed") return <span className="pill bad" title={z.error ?? ""}>Failed, will retry</span>;
    if (z?.status === "sending") return <span className="pill warn">Sending…</span>;
    return <span className="pill">Not sent yet</span>;
  };
  const units = orders.reduce((a, o) => a + (o.final_qty ?? 0), 0);
  return (
    <>
      <h1>Purchase orders</h1>
      <p className="lead">Every order Raghav approved or edited, one line each. Only approved orders appear here. Nothing else can reach this list.</p>
      {live ? (
        <div className="notice" style={{ background: "var(--soft-info)" }}>
          <strong>Connected to Zoho Inventory.</strong> “Send to Zoho” creates a <strong>draft</strong> purchase order from the orders you approved. It is never issued by this system: procurement reviews and places it in Zoho. The CSV download still works.
        </div>
      ) : (
        <div className="notice">
          <strong>Zoho is mocked.</strong> This is not a live integration. Approved orders are listed here and can be downloaded as a CSV
          in place of a purchase-order import. Every row is marked “sent to Zoho (mock)”. No order is placed anywhere.
        </div>
      )}

      <div className="sectionhead">
        <h2>Approved orders ({orders.length}{orders.length ? `, ${units.toLocaleString("en-IN")} units` : ""})</h2>
        <div className="row" style={{ gap: 8 }}>
          {live && <ZohoSend unsent={unsent} cap={SEND_CAP} />}
          {orders.length > 0 && <a href={`/api/orders/csv?${new URLSearchParams({ ...(all ? { all: "1" } : {}), ...(q ? { q } : {}) })}`} download><button className={live ? "secondary" : ""}>Download CSV</button></a>}
        </div>
      </div>
      <div className="row no-print" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div className="tabs" role="tablist" aria-label="Which orders" style={{ margin: 0, borderBottom: 0 }}>
          <Link role="tab" aria-selected={!all} href={q ? `/orders?q=${encodeURIComponent(q)}` : "/orders"} className={`tab${!all ? " active" : ""}`}>Last {RECENT_DAYS} days<span className="n">{totals.recent}</span></Link>
          <Link role="tab" aria-selected={all} href={`/orders?all=1${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`tab${all ? " active" : ""}`}>All orders<span className="n">{totals.all}</span></Link>
        </div>
        <form action="/orders" method="get" className="row" style={{ gap: 8 }}>
          {all && <input type="hidden" name="all" value="1" />}
          <input type="text" name="q" defaultValue={q} placeholder="Search SKU or product" aria-label="Search SKU or product" style={{ width: 220 }} />
          <button className="secondary" type="submit">Search</button>
          {q && <Link href={all ? "/orders?all=1" : "/orders"} className="muted">Clear</Link>}
        </form>
      </div>
      <div style={{ borderBottom: "1px solid var(--line)", marginBottom: 12 }} />
      <p className="muted" style={{ margin: "0 0 12px" }}>
        {q ? `Showing ${orders.length} order${orders.length === 1 ? "" : "s"} matching “${q}” ` : `Showing ${orders.length} order${orders.length === 1 ? "" : "s"} `}
        {all ? "from the whole history." : hidden > 0 ? `from the last ${RECENT_DAYS} days. ${hidden} older ones are under “All orders”.` : `from the last ${RECENT_DAYS} days.`}
      </p>
      {orders.length === 0 ? (
        <div className="card empty">{q ? `No orders match “${q}”.` : all ? "No approved orders yet." : `No orders in the last ${RECENT_DAYS} days.`} {!q && "Approve a flag on the Review page and it will appear here."}</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>SKU</th><th>Product</th><th>Quantity</th><th>Decision</th><th>Reason tag</th><th>Approved</th><th>Status</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.sku_id}</td>
                  <td>{o.name}</td>
                  <td><strong>{o.final_qty!.toLocaleString("en-IN")}</strong>{o.status === "edited" && o.recommended_qty !== null ? <span className="muted"> (recommended {o.recommended_qty.toLocaleString("en-IN")})</span> : null}</td>
                  <td>{o.status === "edited" ? "Edited" : "Approved"}</td>
                  <td>{o.decision_tag ? TAG_LABELS[o.decision_tag as Tag] : <span className="muted">-</span>}</td>
                  <td>{when(o.decided_at)}</td>
                  <td>{zohoCell(o.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pauses.length > 0 && (
        <>
          <h2>Orders paused ({pauses.length})</h2>
          <p className="muted" style={{ marginTop: 0 }}>Approved overstock flags: the next order for these SKUs is held. No quantity, so they are not in the CSV.</p>
          <div className="card" style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>SKU</th><th>Product</th><th>Stock</th><th>Weeks of stock</th><th>Approved</th></tr></thead>
              <tbody>
                {pauses.map((o) => (
                  <tr key={o.id}><td>{o.sku_id}</td><td>{o.name}</td><td>{o.numbers.stock.toLocaleString("en-IN")}</td><td>{o.numbers.weeks_of_stock}</td><td>{when(o.decided_at)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
