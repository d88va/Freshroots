// Loads data/seed/*.csv into Neon through the same adapter the Upload page uses.
//   npm run seed:load
// Safe to run again: rows are upserted, and open POs are replaced.
import fs from "node:fs";
import path from "node:path";
import { getSql } from "../src/lib/db/client";
import { loadCsv } from "../src/lib/db/load";
import type { FileKind } from "../src/lib/csv/adapter";

const FILES: [FileKind, string][] = [
  ["calendar_events", "calendar_events.csv"],
  ["skus", "skus.csv"],
  ["sales", "weekly_sales.csv"],
  ["stock", "stock_snapshots.csv"],
  ["open_pos", "open_pos.csv"],
  ["loss_events", "loss_events.csv"],
];

async function main() {
  const sql = getSql();
  if (process.argv.includes("--reset")) {
    // Wipes the data tables first (so rows from an older seed do not linger). Only for the synthetic seed.
    await sql.query("truncate skus, calendar_events cascade");
    console.log("Reset: data tables emptied.");
  }
  for (const [kind, file] of FILES) {
    const text = fs.readFileSync(path.join(process.cwd(), "data", "seed", file), "utf8");
    process.stdout.write(`Loading ${file} ... `);
    const r = await loadCsv(sql, kind, text, file);
    console.log(`${r.rowsSaved} saved, ${r.rejected.length} rejected`);
    r.rejected.slice(0, 3).forEach((e) => console.log("   ", e));
  }
  for (const t of ["calendar_events", "skus", "weekly_sales", "stock_snapshots", "open_pos", "loss_events"]) {
    const [{ n }] = (await sql.query(`select count(*)::int as n from ${t}`)) as { n: number }[];
    console.log(`  ${t.padEnd(16)} ${n} rows in the database`);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
