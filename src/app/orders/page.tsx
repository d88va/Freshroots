import Link from "next/link";
import { getSql } from "@/lib/db/client";
import { RECENT_DAYS, orderTotals, ordersList, pausesList } from "@/lib/review/data";
import { zohoFromEnv } from "@/lib/zoho/client";
import { SEND_CAP, unsentCount } from "@/lib/zoho/send";
import ZohoSend from "./ZohoSend";
import { TAG_LABELS, type Tag } from "@/lib/review/decide";
import { listPoDays } from "@/lib/po/data";
import { poNumberForDate } from "@/lib/po/format";

export const dynamic = "force-dynamic";

const day = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const when = (d: unknown) => new Date(d as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function Orders({ searchParams }: { searchParams: Promise<{ all?: string; q?: string; tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "po" ? "po" : "orders";
  const all = sp.all === "1";
  const q = (sp.q ?? "").slice(0, 60);
  const sql = getSql();
  const live = zohoFromEnv() !== null;
  const [totals, poDays] = await Promise.all([orderTotals(sql), listPoDays(sql)]);

  return (
    <>
      <h1>Orders</h1>
      <p className="lead">Only orders Raghav approved or edited appear here. Nothing else can reach these lists, and this system places no order: procurement places it.</p>

      <div className="tabs no-print" role="tablist" aria-label="Orders" style={{ marginTop: 0 }}>
        <Link role="tab" aria-selected={tab === "orders"} href="/orders" className={`tab${tab === "orders" ? " active" : ""}`}>Approved orders<span className="n">{totals.all}</span></Link>
        <Link role="tab" aria-selected={tab === "po"} href="/orders?tab=po" className={`tab${tab === "po" ? " active" : ""}`}>Purchase orders<span className="n">{poDays.length}</span></Link>
      </div>

      {tab === "orders" ? await OrdersTab({ all, q, live, totals }) : PoTab({ poDays, live })}
    </>
  );
}

function ZohoBanner({ live }: { live: boolean }) {
  return live ? (
    <div className="notice" style={{ background: "var(--soft-info)" }}>
      <strong>Connected to Zoho Inventory.</strong> “Send to Zoho” creates a <strong>draft</strong> purchase order from the orders you approved. It is never issued by this system: procurement reviews and places it in Zoho. The CSV download still works.
    </div>
  ) : (
    <div className="notice">
      <strong>Zoho is mocked.</strong> This is not a live integration. Approved orders are listed here and can be downloaded as a CSV
      in place of a purchase-order import. Every row is marked “sent to Zoho (mock)”. No order is placed anywhere.
    </div>
  );
}

async function OrdersTab({ all, q, live, totals }: { all: boolean; q: string; live: boolean; totals: { all: number; recent: number } }) {
  const sql = getSql();
  const [orders, pauses] = await Promise.all([ordersList(sql, all, q), pausesList(sql, all)]);
  const hidden = totals.all - totals.recent;
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
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...extra, ...(q ? { q } : {}) }).toString();

  return (
    <>
      <div style={{ marginTop: 20 }}><ZohoBanner live={live} /></div>

      <div className="row no-print" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="seg" role="group" aria-label="Which orders">
          <Link href={`/orders${q ? `?${qs({})}` : ""}`} className={!all ? "on" : ""} aria-current={!all ? "true" : undefined}>Last {RECENT_DAYS} days ({totals.recent})</Link>
          <Link href={`/orders?${qs({ all: "1" })}`} className={all ? "on" : ""} aria-current={all ? "true" : undefined}>All orders ({totals.all})</Link>
        </div>
        <form action="/orders" method="get" className="row" style={{ gap: 8 }}>
          {all && <input type="hidden" name="all" value="1" />}
          <input type="text" name="q" defaultValue={q} placeholder="Search SKU or product" aria-label="Search SKU or product" style={{ width: 220 }} />
          <button className="secondary" type="submit">Search</button>
          {q && <Link href={all ? "/orders?all=1" : "/orders"} className="muted">Clear</Link>}
        </form>
      </div>

      <div className="sectionhead" style={{ marginTop: 8 }}>
        <p className="muted" style={{ margin: 0 }}>
          {q ? `${orders.length} order${orders.length === 1 ? "" : "s"} matching “${q}”` : `${orders.length} order${orders.length === 1 ? "" : "s"}, ${units.toLocaleString("en-IN")} units`}
          {all ? ", from the whole history." : hidden > 0 ? `, from the last ${RECENT_DAYS} days. ${hidden} older ones are under “All orders”.` : `, from the last ${RECENT_DAYS} days.`}
        </p>
        <div className="row" style={{ gap: 8 }}>
          {live && <ZohoSend unsent={unsent} cap={SEND_CAP} />}
          {orders.length > 0 && <a href={`/api/orders/csv?${new URLSearchParams({ ...(all ? { all: "1" } : {}), ...(q ? { q } : {}) })}`} download><button className={live ? "secondary" : ""}>Download CSV</button></a>}
        </div>
      </div>

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
          <p className="muted" style={{ marginTop: 0 }}>Approved overstock flags: the next order for these SKUs is held. No quantity, so they are not in the CSV or on a purchase order.</p>
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

function PoTab({ poDays, live }: { poDays: { date: string; lines: number; units: number }[]; live: boolean }) {
  return (
    <>
      <p className="muted" style={{ margin: "20px 0 12px", maxWidth: 720 }}>
        One purchase order for each day Raghav approved orders, laid out as a document for procurement. Open one to read, print or save it as a PDF. A purchase order places no order: procurement places it.
      </p>
      {poDays.length === 0 ? (
        <div className="card empty">No purchase orders yet. Approve a flag on the Review page and today’s purchase order will appear here.</div>
      ) : (
        <div className="panel">
          <div className="inner" style={{ minWidth: 0 }}>
            <div className="po-list head"><span>Purchase order</span><span>Date</span><span className="num">Lines</span><span className="num">Units</span><span>Zoho</span></div>
            {poDays.map((p) => (
              <Link key={p.date} href={`/orders/po/${p.date}`} className="po-list">
                <span><b>{poNumberForDate(p.date)}</b></span>
                <span className="muted">{day(p.date)}</span>
                <span className="num">{p.lines}</span>
                <span className="num">{p.units.toLocaleString("en-IN")}</span>
                <span>{live ? <span className="muted">See Approved orders</span> : <span className="pill good">sent to Zoho (mock)</span>}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
