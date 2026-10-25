import Link from "next/link";
import { notFound } from "next/navigation";
import { getSql } from "@/lib/db/client";
import { getPoLines } from "@/lib/po/data";
import { changeNote, isPoDate, poNumberForDate, summarize } from "@/lib/po/format";
import { TAG_LABELS, type Tag } from "@/lib/review/decide";
import { zohoFromEnv } from "@/lib/zoho/client";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

const longDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const n0 = (x: number) => x.toLocaleString("en-IN");
const WHY: Record<string, string> = { high_demand: "High demand", stockout_risk: "Stockout risk", overstock_risk: "Overstock risk", needs_judgment: "Judgment order" };

export default async function PurchaseOrder({ params }: { params: Promise<{ date: string }> }) {
  const date = (await params).date;
  if (!isPoDate(date)) notFound();
  const lines = await getPoLines(getSql(), date);
  if (!lines.length) notFound();
  const s = summarize(lines);
  const number = poNumberForDate(date);
  const live = zohoFromEnv() !== null;

  return (
    <>
      <div className="row no-print" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <Link href="/orders?tab=po" className="muted">← Purchase orders</Link>
        <div className="row" style={{ gap: 8 }}>
          <PrintButton />
          <a href={`/api/orders/csv?po=${date}`} download><button className="secondary">Download CSV</button></a>
        </div>
      </div>

      <article className="invoice" aria-label={`Purchase order ${number}`}>
        <header className="inv-head">
          <div>
            <div className="inv-brand">Freshroots</div>
            <div className="soft">FMCG distribution, Maharashtra and Goa</div>
          </div>
          <div className="inv-title"><div className="t">PURCHASE ORDER</div><div className="n">{number}</div></div>
        </header>

        <div className="inv-meta">
          <div><div className="inv-label">PO date</div><div className="inv-val">{longDate(date)}</div></div>
          <div><div className="inv-label">Prepared by</div><div className="inv-val">Raghav Kulkarni</div><div className="soft">Senior Demand Planner</div></div>
          <div><div className="inv-label">Lines</div><div className="inv-val">{s.lines}</div></div>
          <div><div className="inv-label">Zoho</div><div className="inv-val">{live ? "See Orders tab" : "Sent to Zoho (mock)"}</div></div>
        </div>

        <div className="inv-parties">
          <div className="inv-box"><div className="inv-label">Supplier</div><div className="inv-val" style={{ fontWeight: 400 }}>To be assigned by procurement</div></div>
          <div className="inv-box"><div className="inv-label">Deliver to</div><div className="inv-val" style={{ fontWeight: 400 }}>As confirmed by procurement</div></div>
        </div>

        <table className="inv-table">
          <thead><tr><th style={{ width: 36 }}>#</th><th style={{ width: 90 }}>SKU</th><th>Item</th><th className="r" style={{ width: 90 }}>Quantity</th><th style={{ width: 60 }}>Unit</th><th>Notes</th></tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const note = changeNote(l);
              return (
                <tr key={l.sku_id}>
                  <td className="soft">{i + 1}</td>
                  <td>{l.sku_id}</td>
                  <td><b>{l.name}</b><div className="soft">{l.category}{l.is_perishable ? " · Perishable" : ""}</div></td>
                  <td className="r"><b>{n0(l.quantity)}</b></td>
                  <td className="soft">units</td>
                  <td className="soft">
                    {l.urgent ? "Urgent. " : ""}{WHY[l.flag_type] ?? l.flag_type}{l.weeks_of_stock !== null ? `, ${l.weeks_of_stock} weeks of stock` : ""}
                    {note && <div>{note}</div>}
                    {l.decision_tag && <div>Reason noted: {TAG_LABELS[l.decision_tag as Tag]}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="inv-sum">
          <table>
            <tbody>
              {s.byCategory.map((c) => <tr key={c.category}><td className="soft">{c.category} ({c.lines} {c.lines === 1 ? "line" : "lines"})</td><td className="r">{n0(c.units)}</td></tr>)}
              <tr className="total"><td>Total units</td><td className="r">{n0(s.units)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="inv-notes">
          <div className="inv-label">Notes</div>
          <p style={{ margin: "4px 0 0" }}>
            Prices, supplier and delivery dates are set by procurement. Every line was approved{s.edited ? ` (${s.edited} with a quantity changed by Raghav)` : ""} by Raghav Kulkarni.
            This document was prepared by the Freshroots demand planning system. <b>It places no order: procurement places the order.</b>
          </p>
        </div>

        <div className="inv-sign">
          <div>Approved by Raghav Kulkarni, Senior Demand Planner<br />Date</div>
          <div>Received by procurement<br />Date</div>
        </div>
      </article>
    </>
  );
}
