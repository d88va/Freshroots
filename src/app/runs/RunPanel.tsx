"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RunPanel({ paused, aiWaiting }: { paused: boolean; aiWaiting: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"run" | "ai" | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  async function call(kind: "run" | "ai") {
    setBusy(kind);
    setMsg(null);
    try {
      const res = await fetch(kind === "run" ? "/api/runs/now" : "/api/reasons/fill", { method: "POST" });
      const j = await res.json();
      if (!res.ok) setMsg({ text: j.error ?? "Something went wrong.", bad: true });
      else if (kind === "run") {
        const s = j.summary;
        setMsg({ text: `Run ${s.run_id} done. The rules flagged ${s.flagged_total} SKUs: ${s.new} new, ${s.refreshed} updated, ${s.unchanged} already pending, ${s.held} held back (decided recently). ${s.reasons.ai} AI reasons written.`, bad: false });
      } else setMsg({ text: `${j.ai} AI reasons written. ${j.waiting} still waiting${j.quota_left <= 0 ? " (today's Gemini allowance is used up)" : ""}.`, bad: false });
      router.refresh();
    } catch {
      setMsg({ text: "Could not reach the server.", bad: true });
    }
    setBusy(null);
  }

  return (
    <div>
      <div className="row">
        <button onClick={() => call("run")} disabled={busy !== null || paused} title={paused ? "The system is paused" : undefined}>{busy === "run" ? "Running… (up to a minute)" : "Run now"}</button>
        <button className="secondary" onClick={() => call("ai")} disabled={busy !== null || aiWaiting === 0}>{busy === "ai" ? "Writing…" : `Write AI reasons (${aiWaiting} waiting)`}</button>
      </div>
      {paused && <p className="err" style={{ margin: "8px 0 0" }}>The system is paused, so Run now and the schedule are blocked.</p>}
      {msg && <p className={msg.bad ? "err" : "ok"} style={{ margin: "8px 0 0" }} role="status">{msg.text}</p>}
    </div>
  );
}
