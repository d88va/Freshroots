import Link from "next/link";
import type { ShellData } from "@/lib/shell";

// Shown above every page. A paused system always says so. A red K3 SUGGESTS a pause, but nothing here pauses anything.
export default function StatusBanners({ shell }: { shell: ShellData | null }) {
  if (!shell) return null;
  const { pause, k3 } = shell;
  if (pause.paused) {
    return (
      <div className="banner bad" role="status">
        <span><strong>System paused.</strong> The schedule, Run now and the outcome check are blocked. Existing flags stay visible.{pause.paused_reason ? ` Reason: ${pause.paused_reason}.` : ""}</span>
        <Link href="/settings#pause">Resume in Settings</Link>
      </div>
    );
  }
  if (k3 && k3.status === "red") {
    return (
      <div className="banner warn" role="status">
        <span><strong>K3 is red: consider pausing.</strong> {k3.current}. This is a stop signal for you, not for the system: it will not pause itself.</span>
        <Link href="/settings#pause">Pause in Settings</Link>
      </div>
    );
  }
  return null;
}
