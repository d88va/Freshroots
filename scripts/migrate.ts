// Applies neon/migrations/*.sql in order, once each.
//   npm run db:migrate
// Safe to run again: files already applied are skipped.
import fs from "node:fs";
import path from "node:path";
import { getSql } from "../src/lib/db/client";

async function main() {
  const sql = getSql();
  await sql.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set(((await sql.query("select name from schema_migrations")) as { name: string }[]).map((r) => r.name));
  const dir = path.join(process.cwd(), "neon", "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) { console.log(`skip   ${file} (already applied)`); continue; }
    // Split into single statements (the driver runs one at a time). Comment lines are dropped first.
    const text = fs.readFileSync(path.join(dir, file), "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    const statements = text.split(";").map((s) => s.trim()).filter(Boolean);
    for (const s of statements) await sql.query(s);
    await sql.query("insert into schema_migrations (name) values ($1)", [file]);
    console.log(`apply  ${file} (${statements.length} statements)`);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
