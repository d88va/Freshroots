import { neon } from "@neondatabase/serverless";

// Server-side only. DATABASE_URL is the Neon connection string (an environment variable);
// it is read in API routes and scripts and never sent to the browser.
export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to your Neon connection string (see .env.local.example).");
  // no-store: Next.js caches fetch calls by default, and this driver talks to Neon over fetch. Cached results would show old flags.
  return neon(url, { fetchOptions: { cache: "no-store" } });
}
export type Sql = ReturnType<typeof getSql>;

const BATCH = 1000;

/**
 * Inserts rows in batches. With `conflict`, existing rows (same key) are updated instead:
 * that is what makes loading the same file twice safe.
 */
export async function bulkWrite(sql: Sql, table: string, columns: string[], rows: Record<string, unknown>[], conflict?: string[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const tuples = chunk.map((r) => `(${columns.map((c) => { params.push(r[c] ?? null); return `$${params.length}`; }).join(",")})`);
    let text = `insert into ${table} (${columns.join(",")}) values ${tuples.join(",")}`;
    if (conflict) {
      const updates = columns.filter((c) => !conflict.includes(c));
      text += ` on conflict (${conflict.join(",")}) ` + (updates.length ? `do update set ${updates.map((c) => `${c}=excluded.${c}`).join(",")}` : "do nothing");
    }
    await sql.query(text, params);
  }
}
