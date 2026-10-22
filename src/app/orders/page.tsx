import { getSql } from "@/lib/db/client";
import { ordersList, pausesList } from "@/lib/review/data";
import { TAG_LABELS, type Tag } from "@/lib/review/decide";

export const dynamic = "force-dynamic";

const when = (d: unknown) => new Date(d as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function Orders() {
  const sql = getSql();
  const [orders, pauses] = await Promise.all([ordersList(sql), pausesList(sql)]);
  const units = orders.reduce((a, o) => a + (o.final_qty ?? 0), 0);
  return (
    <>
      <h1>Orders</h1>
      <p className="lead">Only flags Raghav approved or edited appear here. Nothing else can reach this list.</p>
      <div className="notice">
        <strong>Zoho is mocked.</strong> This is not a live integration. Approved orders are listed here and can be downloaded as a CSV
        in place of a purchase-order import. Every row is marked “sent to Zoho (mock)”. No order is placed anywhere.
      </div>

      <div className="sectionhead">
        <h2>Approved orders ({orders.length}{orders.length ? `, ${units.toLocaleString("en-IN")} units` : ""})</h2>
        {orders.length > 0 && <a href="/api/orders/csv" download><button>Download CSV</button></a>}
      </div>
      {orders.length === 0 ? (
        <div className="card empty">No approved orders yet. Approve a flag on the Review page and it will appear here.</div>
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
                  <td><span className="pill good">sent to Zoho (mock)</span></td>
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
