import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Freshroots Demand Planning", description: "Twice-weekly reorder flags for Raghav to review" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="inner">
            <strong>Freshroots Demand Planning</strong>
            <Link href="/">Home</Link>
            <Link href="/review">Review</Link>
            <Link href="/orders">Orders</Link>
            <Link href="/overrides">Override log</Link>
            <Link href="/backtest">Backtest</Link>
            <Link href="/upload">Upload data</Link>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
