"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface BulkSummary { ids: number[]; reorders: number; units: number; pauses: number; judgment: number }

export default function ApproveAll({ s }: { s: BulkSummary }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!s.ids.length) return null;

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/flags/bulk-approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: s.ids }) });
    setBusy(false);
    if (!res.ok) return setError((await res.json()).error ?? "Something went wrong.");
    dialog.current?.close();
    router.refresh();
  }

  return (
    <>
      <button className="secondary" onClick={() => dialog.current?.showModal()}>Approve all {s.ids.length} standard flags…</button>
      <dialog ref={dialog}>
        <h2 style={{ marginTop: 0 }}>Approve {s.ids.length} flags?</h2>
        <p>This approves every flag below the line exactly as the rules recommend, without changes:</p>
        <ul>
          <li><strong>{s.reorders}</strong> reorders, {s.units.toLocaleString("en-IN")} units in total. They go to the Orders page.</li>
          <li><strong>{s.pauses}</strong> pauses. No order is created.</li>
        </ul>
        {s.judgment > 0 && <p className="muted">The {s.judgment} flag{s.judgment === 1 ? "" : "s"} that need your judgment are not included. You decide those one at a time.</p>}
        {error && <p className="err">{error}</p>}
        <div className="actions">
          <button onClick={confirm} disabled={busy}>{busy ? "Approving…" : `Approve ${s.ids.length}`}</button>
          <button className="secondary" onClick={() => dialog.current?.close()} disabled={busy}>Cancel</button>
        </div>
      </dialog>
    </>
  );
}
