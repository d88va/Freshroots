"use client";
import { useState } from "react";

export default function ZohoCard({ configured, dc, orgId, vendorId, autoCreate }: { configured: boolean; dc: string; orgId: string; vendorId: string; autoCreate: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  async function test() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/zoho/test", { method: "POST" });
    const j = await res.json();
    setBusy(false);
    setMsg(res.ok ? { text: `Connected. Organisation: ${j.orgName}.`, bad: false } : { text: j.error ?? "Could not connect.", bad: true });
  }
  return (
    <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start", justifyContent: "space-between", padding: 24 }}>
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <div className="row" style={{ gap: 10 }}>
          <strong style={{ fontSize: 16, lineHeight: "24px" }}>Zoho Inventory</strong>
          <span className={`pill ${configured ? "good" : ""}`}>{configured ? "CONNECTED (draft purchase orders)" : "MOCK MODE"}</span>
        </div>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          {configured
            ? `Data centre ${dc}, organisation ${orgId}, vendor ${vendorId}${autoCreate ? ", missing items are created automatically" : ""}. Approved orders can be sent as draft purchase orders. Nothing is ever issued by the system.`
            : "Not connected, so approved orders are only listed on the Orders page and downloaded as a CSV. To connect, add the ZOHO_ values to the environment and redeploy. The README lists them."}
        </p>
      </div>
      <div style={{ flex: "0 0 auto" }}>
        <button className="secondary" onClick={test} disabled={busy || !configured}>{busy ? "Testing…" : "Test connection"}</button>
        {msg && <p className={msg.bad ? "err" : "ok"} role="status" style={{ margin: "8px 0 0", maxWidth: 320 }}>{msg.text}</p>}
      </div>
    </div>
  );
}
