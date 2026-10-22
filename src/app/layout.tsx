import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import AppShell from "@/components/AppShell";
import StatusBanners from "@/components/StatusBanners";
import { getSql } from "@/lib/db/client";
import { loadShell } from "@/lib/shell";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = { title: "Freshroots Demand Planning", description: "Twice-weekly reorder flags for Raghav to review" };
export const dynamic = "force-dynamic"; // the shell reads the pause switch and the counts on every request

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const shell = await loadShell(getSql());
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <StatusBanners shell={shell} />
        <AppShell shell={shell}>{children}</AppShell>
      </body>
    </html>
  );
}
