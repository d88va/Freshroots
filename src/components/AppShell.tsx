"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ShellData } from "@/lib/shell";

// The navigation follows the job: decide today, plan the week, check it is working, set it up.
interface NavItem { label: string; href: string; icon: string; count?: "review" | "feedback"; dot?: "k3" }
const GROUPS: { name: string; items: NavItem[] }[] = [
  { name: "Today", items: [
    { label: "Review", href: "/review", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11", count: "review" },
    { label: "Orders", href: "/orders", icon: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" },
  ] },
  { name: "Plan", items: [
    { label: "Runs", href: "/runs", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2" },
    { label: "Season calendar", href: "/calendar", icon: "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18" },
    { label: "Feedback", href: "/feedback", icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", count: "feedback" },
  ] },
  { name: "Monitor", items: [
    { label: "Metrics", href: "/metrics", icon: "M22 12h-4l-3 9L9 3l-3 9H2", dot: "k3" },
    { label: "Backtest", href: "/backtest", icon: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2" },
    { label: "Override log", href: "/overrides", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
  ] },
  { name: "Setup", items: [
    { label: "Settings", href: "/settings", icon: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" },
    { label: "Upload data", href: "/upload", icon: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" },
  ] },
];

const ALL: NavItem[] = GROUPS.flatMap((g) => g.items);

function Icon({ d }: { d: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

function Nav({ shell, path }: { shell: ShellData | null; path: string }) {
  const counts: Record<string, number | undefined> = { review: shell?.reviewCount, feedback: shell?.feedbackCount };
  const k3Dot = shell?.k3?.status === "red" ? "bad" : shell?.k3?.status === "amber" ? "warn" : null;
  return (
    <>
      {GROUPS.map((g) => (
        <div key={g.name} className="nav-group">
          <div className="nav-label">{g.name}</div>
          {g.items.map((i) => {
            const active = path === i.href || path.startsWith(i.href + "/");
            const n = i.count ? counts[i.count] : undefined;
            return (
              <Link key={i.href} href={i.href} className={`nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
                <Icon d={i.icon} />
                <span className="grow">{i.label}</span>
                {n ? <span className="nav-count">{n}</span> : null}
                {i.dot && k3Dot ? <span className={`dot ${k3Dot}`} role="img" aria-label={k3Dot === "bad" ? "K3 is red" : "K3 is amber"} /> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function Status({ shell }: { shell: ShellData | null }) {
  if (!shell) return null;
  const paused = shell.pause.paused;
  return (
    <div className="status-card" role="status">
      <div className="s1"><span className={`dot ${paused ? "bad" : "good"}`} />{paused ? "Paused" : "Running"}</div>
      <div className="s2">{paused ? "Runs are blocked until you resume" : `Next run ${shell.nextRun} IST`}</div>
    </div>
  );
}

export default function AppShell({ shell, children }: { shell: ShellData | null; children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const title = ALL.find((i) => path === i.href || path.startsWith(i.href + "/"))?.label ?? "Freshroots";

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main">
        <Link href="/" className="brand"><span className="brand-mark">F</span><span><b>Freshroots</b><span>Demand planning</span></span></Link>
        <nav style={{ display: "contents" }}><Nav shell={shell} path={path} /></nav>
        <Status shell={shell} />
      </aside>

      <header className="topbar">
        <button className="icon-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <span className="title">{title}</span>
        <span className="icon-btn" role="img" aria-label={shell?.pause.paused ? "System paused" : "System running"}><span className={`dot ${shell?.pause.paused ? "bad" : "good"}`} /></span>
      </header>

      <div className={`scrim${open ? " open" : ""}`} onClick={() => setOpen(false)} />
      <div className={`drawer${open ? " open" : ""}`} role="dialog" aria-label="Menu" aria-hidden={!open}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", paddingLeft: 8 }}>
          <Link href="/" className="brand"><span className="brand-mark">F</span><b>Freshroots</b></Link>
          <button className="icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <nav style={{ display: "contents" }}><Nav shell={shell} path={path} /></nav>
        <Status shell={shell} />
      </div>

      <main className="content"><div className="content-inner">{children}</div></main>
    </div>
  );
}
