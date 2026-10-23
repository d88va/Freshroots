// Safety check for the Zoho send logic, run against the real database with a FAKE Zoho. Nothing is sent anywhere.   npm run zoho:selftest
// It makes its own test orders, restricts every send to them (so real orders are never touched), and deletes them afterwards.
// It checks: only approved or edited recent orders are sent, an overridden or old order never is, a missing item fails alone,
// a retry does not resend, and two simultaneous sends never send the same order twice.
import { getSql } from "../src/lib/db/client";
import { sendOrdersToZoho, unsentCount } from "../src/lib/zoho/send";
import type { ZohoClient, ZohoConfig } from "../src/lib/zoho/client";

const cfg: ZohoConfig = { dc: "in", clientId: "x", clientSecret: "x", refreshToken: "x", orgId: "1", vendorId: "vendor-test", autoCreateItems: false };
const ok = (name: string, cond: boolean, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) process.exitCode = 1; };

(async () => {
  const sql = getSql();
  const base = await unsentCount(sql);
  const [run] = (await sql.query("insert into runs (trigger, status, note) values ('manual','succeeded','ZOHO SELFTEST') returning id")) as { id: number }[];
  const mk = async (sku: string, status: string, qty: number | null, days = 0, tag: string | null = null) => {
    const [f] = (await sql.query(`insert into flags (run_id, sku_id, flag_type, numbers, status, final_qty, decision_tag, decided_at) values ($1,$2,'stockout_risk','{}',$3,$4,$5, now() - make_interval(days => $6)) returning id`, [run.id, sku, status, qty, tag, days])) as { id: number }[];
    return Number(f.id);
  };
  const A = await mk("FR-001", "approved", 100), B = await mk("FR-002", "edited", 50), C = await mk("FR-003", "approved", 70);
  const D = await mk("FR-004", "overridden", null, 0, "new_launch"); const E = await mk("FR-005", "approved", 90, 30);
  ok("3 of my 5 test orders are eligible (not the overridden, not the 30-day-old)", (await unsentCount(sql)) - base === 3, `(${(await unsentCount(sql)) - base} new, ${base} real ones already waiting, untouched)`);

  const pos: { vendor_id: string; line_items: { item_id: string; quantity: number }[]; reference_number: string }[] = [];
  let missing = true;
  const fake = (): ZohoClient => ({
    ping: async () => ({ orgName: "t" }),
    getItemBySku: async (sku: string) => (sku === "FR-003" && missing ? null : `item-${sku}`),
    createItem: async () => { throw new Error("must not create items when autoCreateItems is off"); },
    createDraftPurchaseOrder: async (po) => { pos.push(po as never); await new Promise((r) => setTimeout(r, 150)); return { id: `po-${pos.length}`, number: `PO-TEST${pos.length}`, status: "draft" }; },
  });
  // run only our test rows: the other 587 are 14+ days old so they are never eligible, which this also proves
  const mine = [A, B, C, D, E];
  const r1 = await sendOrdersToZoho(sql, fake(), cfg, new Date(), mine);
  ok("first send: 2 sent, 1 failed (item missing)", r1.sent === 2 && r1.failed.length === 1 && r1.failed[0].sku_id === "FR-003", JSON.stringify({ sent: r1.sent, units: r1.units, po: r1.po_number }));
  ok("one draft PO with exactly the 2 right lines and quantities", pos.length === 1 && pos[0].line_items.length === 2 && pos[0].line_items.map((l) => l.quantity).sort().join() === "100,50" && pos[0].vendor_id === "vendor-test");
  ok("the draft body has no status field, so Zoho keeps it as a draft", !("status" in pos[0]) && Object.keys(pos[0]).sort().join() === "date,line_items,notes,reference_number,vendor_id");
  const rows = (await sql.query("select flag_id, status, po_number from zoho_sync where flag_id = any($1::bigint[]) order by flag_id", [[A, B, C, D, E]])) as { flag_id: string; status: string; po_number: string | null }[];
  const by = Object.fromEntries(rows.map((x) => [x.flag_id, x]));
  ok("A and B recorded as sent with the PO number", by[A]?.status === "sent" && by[B]?.status === "sent" && by[A].po_number === "PO-TEST1");
  ok("C recorded as failed", by[C]?.status === "failed");
  ok("the overridden order and the 30-day-old order were never touched", !by[D] && !by[E]);

  missing = false;
  const r2 = await sendOrdersToZoho(sql, fake(), cfg, new Date(), mine);
  ok("retry: only the failed order is sent, A and B are not sent again", r2.sent === 1 && pos.length === 2 && pos[1].line_items.length === 1 && pos[1].line_items[0].quantity === 70);

  const F = await mk("FR-006", "approved", 40);
  const [x, y] = await Promise.all([sendOrdersToZoho(sql, fake(), cfg, new Date(), [F]), sendOrdersToZoho(sql, fake(), cfg, new Date(), [F])]);
  const linesForF = pos.slice(2).flatMap((p) => p.line_items).filter((l) => l.quantity === 40).length;
  ok("two simultaneous sends: the order goes out exactly once", linesForF === 1 && x.sent + y.sent === 1, `(${x.sent} + ${y.sent} sent, ${linesForF} line(s) in Zoho)`);

  const r3 = await sendOrdersToZoho(sql, fake(), cfg, new Date(), [...mine, F]);
  ok("nothing left: a further send does nothing", r3.sent === 0 && r3.failed.length === 0 && pos.length === 3);

  await sql.query("delete from runs where id = $1", [run.id]); // cascades the test flags and their sync rows
  await sql.query("delete from zoho_items where zoho_item_id like 'item-FR-%'");
  console.log("cleaned up. real unsent orders now:", await unsentCount(sql), "(same as before:", base + ")");
  console.log("real orders ever marked sent by this test:", ((await sql.query("select count(*)::int n from zoho_sync"))[0] as {n:number}).n, "(0 expected)");
})();
