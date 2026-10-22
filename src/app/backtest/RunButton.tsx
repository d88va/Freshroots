"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest", { method: "POST" });
      if (!res.ok) setError((await res.json()).error ?? "The backtest failed.");
      else router.refresh();
    } catch {
      setError("The backtest failed. Check your connection.");
    }
    setBusy(false);
  }
  return (
    <div className="row">
      <button onClick={go} disabled={busy}>{busy ? "Replaying 3 years… (about 15 seconds)" : "Run backtest again"}</button>
      {error && <span className="err">{error}</span>}
    </div>
  );
}
