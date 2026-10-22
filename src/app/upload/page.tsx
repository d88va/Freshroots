"use client";
import { useState } from "react";
import { FILE_KINDS, type FileKind } from "@/lib/csv/adapter";

interface Result { kind: FileKind; rowsRead: number; rowsSaved: number; rejected: { line: number; message: string }[]; warnings: string[]; error?: string }

export default function Upload() {
  const [busy, setBusy] = useState<FileKind | null>(null);
  const [results, setResults] = useState<Partial<Record<FileKind, Result>>>({});

  async function submit(kind: FileKind, form: HTMLFormElement) {
    setBusy(kind);
    const data = new FormData(form);
    data.set("kind", kind);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: data });
      const json = await res.json();
      setResults((r) => ({ ...r, [kind]: res.ok ? json : { kind, rowsRead: 0, rowsSaved: 0, rejected: [], warnings: [], error: json.error } }));
    } catch {
      setResults((r) => ({ ...r, [kind]: { kind, rowsRead: 0, rowsSaved: 0, rejected: [], warnings: [], error: "Upload failed. Check your connection." } }));
    }
    setBusy(null);
  }

  return (
    <>
      <h1>Upload data</h1>
      <p className="lead">Drop in CSV exports. Load the SKU master first; everything else refers to it.</p>
      <div className="notice">
        SAP-style files (sales, stock, SKU master) and Zoho-style files (open POs) are read from CSV. This is not a live integration.
        Column names are flexible (for example <code>Material</code> works as <code>sku_id</code>), dates can be <code>2026-10-19</code>,{" "}
        <code>19/10/2026</code> or <code>20261019</code>, and sales rows can be per distributor, per day or per week: they are summed into one row per SKU per week.
      </div>
      {FILE_KINDS.map((k) => {
        const r = results[k.kind];
        return (
          <form key={k.kind} className="card" onSubmit={(e) => { e.preventDefault(); submit(k.kind, e.currentTarget); }}>
            <strong>{k.label}</strong> <span className="muted">({k.source})</span>
            <p className="muted" style={{ margin: "4px 0 10px" }}>Columns: {k.columns}</p>
            <div className="row">
              <input type="file" name="file" accept=".csv,text/csv" required />
              <button type="submit" disabled={busy !== null}>{busy === k.kind ? "Uploading…" : "Upload"}</button>
            </div>
            {r?.error && <p className="err">{r.error}</p>}
            {r && !r.error && (
              <p className={r.rejected.length ? "err" : "ok"}>
                Read {r.rowsRead.toLocaleString()} rows, saved {r.rowsSaved.toLocaleString()}
                {r.rejected.length ? `, skipped ${r.rejected.length}:` : "."}
              </p>
            )}
            {r?.rejected.slice(0, 5).map((e, i) => <div key={i} className="muted">{e.line ? `Line ${e.line}: ` : ""}{e.message}</div>)}
            {r?.warnings.map((w, i) => <div key={i} className="muted">{w}</div>)}
          </form>
        );
      })}
    </>
  );
}
