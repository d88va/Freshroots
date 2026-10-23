"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Result { sent: number; units: number; po_number: string | null; failed: { sku_id: string; name: string; error: string }[]; error?: string }

export default function ZohoSend({ unsent, cap }: { unsent: number; cap: number }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function send() {
    setBusy(true);
    const res = await fetch("/api/zoho/send", { method: "POST" });
    const j = await res.json();
    setBusy(false);
    setResult(res.ok ? j : { sent: 0, units: 0, po_number: null, failed: [], error: j.error ?? "Something went wrong." });
    router.refresh();
  }

  return (
    <>
      <button disabled={unsent === 0} onClick={() => { setResult(null); dialog.current?.showModal(); }}>
        {unsent === 0 ? "Nothing to send" : `Send ${Math.min(unsent, cap)} to Zoho as a draft…`}
      </button>
      <dialog ref={dialog}>
        {!result ? (
          <>
            <h2 style={{ marginTop: 0 }}>Send {Math.min(unsent, cap)} order{Math.min(unsent, cap) === 1 ? "" : "s"} to Zoho?</h2>
            <p>This creates <strong>one draft purchase order</strong> in Zoho Inventory with a line for each order you approved.</p>
            <ul>
              <li>It is a <strong>draft</strong>. Nothing is issued. Procurement reviews it and places it in Zoho.</li>
              <li>Only orders you approved or edited in the last 14 days are included.</li>
              <li>An order is never sent twice.</li>
            </ul>
            {unsent > cap && <p className="muted">{unsent - cap} more will wait for the next send (up to {cap} lines at a time).</p>}
            <div className="actions">
              <button onClick={send} disabled={busy}>{busy ? "Creating the draft…" : "Create the draft in Zoho"}</button>
              <button className="secondary" onClick={() => dialog.current?.close()} disabled={busy}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 0 }}>{result.error ? "Could not send" : result.sent ? "Draft created" : "Nothing was sent"}</h2>
            {result.error && <p className="err">{result.error}</p>}
            {result.sent > 0 && <p className="ok">{result.sent} order{result.sent === 1 ? "" : "s"} ({result.units.toLocaleString("en-IN")} units) are in Zoho as draft <strong>{result.po_number}</strong>. Procurement can now review and place it there.</p>}
            {result.failed.length > 0 && (
              <>
                <p className="err" style={{ marginBottom: 4 }}>{result.failed.length} could not be sent:</p>
                <ul style={{ marginTop: 0 }}>{result.failed.slice(0, 6).map((f) => <li key={f.sku_id}>{f.sku_id} {f.name}: {f.error}</li>)}</ul>
              </>
            )}
            <div className="actions"><button onClick={() => dialog.current?.close()}>Close</button></div>
          </>
        )}
      </dialog>
    </>
  );
}
