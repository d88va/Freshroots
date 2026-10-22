"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CheckButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/outcomes/check", { method: "POST" });
      const j = await res.json();
      if (!res.ok) setMsg({ text: j.error ?? "Something went wrong.", bad: true });
      else setMsg({ text: `Checked ${j.outcomes.end_states + j.outcomes.override_checks} new decisions (${j.outcomes.override_checks} overrides: Raghav right ${j.outcomes.right}, wrong ${j.outcomes.wrong}), found ${j.outcomes.misses} new misses. ${j.suggestions.created} new suggestion${j.suggestions.created === 1 ? "" : "s"}.`, bad: false });
      router.refresh();
    } catch { setMsg({ text: "Could not reach the server.", bad: true }); }
    setBusy(false);
  }
  return (
    <div>
      <button className="secondary" onClick={go} disabled={busy}>{busy ? "Checking… (up to a minute)" : "Run outcome check now"}</button>
      {msg && <p className={msg.bad ? "err" : "ok"} style={{ margin: "8px 0 0" }} role="status">{msg.text}</p>}
    </div>
  );
}
