import { getSql } from "@/lib/db/client";
import { loadCriteria } from "@/lib/kill/load";
import type { Status } from "@/lib/kill/criteria";
import { asOfDate } from "@/lib/run/state";

export const dynamic = "force-dynamic";

const lakh = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `₹${(n / 100000).toFixed(1)}L`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const STYLE: Record<Status, { cls: string; label: string; color: string }> = { green: { cls: "good", label: "GREEN", color: "var(--good)" }, amber: { cls: "warn", label: "AMBER", color: "var(--warn)" }, red: { cls: "bad", label: "RED", color: "var(--bad)" }, grey: { cls: "", label: "NOT YET", color: "var(--muted)" } };
const dayLabel = (d: unknown) => new Date(d as string).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function Metrics() {
  const sql = getSql();
  const today = await asOfDate(sql);
  const criteria = await loadCriteria(sql, today);
  const s = Object.fromEntries(((await sql.query("select key, value from rule_settings where key in ('go_live_date')")) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const goLive = typeof s.go_live_date === "string" ? s.go_live_date : null;

  const [tot] = (await sql.query(
    `select count(*)::int as raised, count(*) filter (where status = 'approved')::int as approved, count(*) filter (where status = 'edited')::int as edited,
            count(*) filter (where status = 'overridden')::int as overridden, count(*) filter (where status = 'pending')::int as pending
       from flags where ($1::date is null or (created_at at time zone 'Asia/Kolkata')::date >= $1::date)`, [goLive])) as { raised: number; approved: number; edited: number; overridden: number; pending: number }[];
  const [age] = (await sql.query(
    `select percentile_cont(0.5) within group (order by a)::float8 as median, percentile_cont(0.9) within group (order by a)::float8 as p90, count(*)::int as n from (
       select (decided_at at time zone 'Asia/Kolkata')::date - (date_trunc('week', (numbers->>'run_date')::date)::date - 1) as a
         from flags where status <> 'pending' and numbers ? 'run_date' and ($1::date is null or (created_at at time zone 'Asia/Kolkata')::date >= $1::date)) t`, [goLive])) as { median: number | null; p90: number | null; n: number }[];

  const quarters = (await sql.query(
    `select to_char(date_trunc('quarter', week_start), 'YYYY-"Q"Q') as q, date_trunc('quarter', week_start)::date::text as qs,
            coalesce(sum(value_inr) filter (where type = 'stockout'), 0)::float8 as so, coalesce(sum(value_inr) filter (where type = 'write_off'), 0)::float8 as wo
       from loss_events group by 1, 2 order by 2 desc`)) as { q: string; qs: string; so: number; wo: number }[];
  const [{ last_loss }] = (await sql.query("select max(week_start)::text as last_loss from loss_events")) as { last_loss: string }[];
  const lastYear = (qs: string) => { const y = Number(qs.slice(0, 4)) - 1; return quarters.find((x) => x.qs === `${y}${qs.slice(4)}`); };
  const isPartial = (qs: string) => { const d = new Date(qs + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 3); return d.toISOString().slice(0, 10) > last_loss; };
  const full = quarters.filter((q) => !isPartial(q.qs));
  const latestFull = full[0];

  const weekly = (await sql.query(
    `with w as (select date_trunc('week', created_at at time zone 'Asia/Kolkata')::date as wk, count(*)::int as raised from flags group by 1),
          d as (select date_trunc('week', decided_at at time zone 'Asia/Kolkata')::date as wk, count(*) filter (where status = 'approved')::int as a, count(*) filter (where status = 'edited')::int as e, count(*) filter (where status = 'overridden')::int as o
                  from flags where status <> 'pending' group by 1)
     select coalesce(w.wk, d.wk)::text as wk, coalesce(w.raised, 0) as raised, coalesce(d.a, 0) as a, coalesce(d.e, 0) as e, coalesce(d.o, 0) as o
       from w full join d on w.wk = d.wk order by 1 desc limit 8`)) as { wk: string; raised: number; a: number; e: number; o: number }[];

  const decided = tot.approved + tot.edited + tot.overridden;
  const ageDays = age.median;

  const chart = full.slice(0, 5).reverse();
  const top = Math.max(1, ...chart.map((q) => q.so + q.wo));
  const px = (v: number) => `${Math.round((v / top) * 168)}px`;

  return (
    <>
      <h1>Metrics</h1>
      <p className="lead">Is it working, and should the build carry on? These four signals only show status. Stopping or pausing is always your decision.</p>

      <h2 style={{ marginTop: 28 }}>Kill criteria</h2>
      <div className="panel">
        <div className="inner" style={{ minWidth: 0 }}>
          {criteria.map((k) => (
            <div key={k.id} className="krow">
              <div className="klabel" style={{ color: STYLE[k.status].color }}><span className="dot" style={{ background: STYLE[k.status].color }} />{STYLE[k.status].label}</div>
              <div><div style={{ fontWeight: 600 }}>{k.id} {k.title}</div><div className="fr-sub">{k.where}</div></div>
              <div><div className="kvalue">{k.current}</div><div className="muted" style={{ marginTop: 2, fontSize: 13 }}>{k.detail.map((d, i) => <div key={i}>{d}</div>)}</div></div>
              <div className="muted" style={{ fontSize: 13 }}>{k.threshold}</div>
            </div>
          ))}
        </div>
      </div>
      <p className="muted" style={{ margin: "-4px 0 0", fontSize: 13 }}>A red K3 shows a banner suggesting a pause. It never pauses by itself. Thresholds and dates are set in <a href="/settings">Settings</a>.</p>

      <h2>Baseline against what the system measures</h2>
      <div className="panel">
        <div className="inner">
          <div className="mhead"><span>Measure</span><span>Baseline, from the brief</span><span>Measured</span></div>
          {[
            ["Stockout losses a quarter", "₹18–22L", latestFull ? lakh(latestFull.so) : "-", latestFull ? `in ${latestFull.q}, ${lakh(lastYear(latestFull.qs)?.so)} a year earlier` : ""],
            ["Write-off losses a quarter", "₹10–12L", latestFull ? lakh(latestFull.wo) : "-", latestFull ? `in ${latestFull.q}, ${lakh(lastYear(latestFull.qs)?.wo)} a year earlier` : ""],
            ["Total loss a quarter", "₹28–34L. Goal: recover 25% (₹7–8.5L)", latestFull ? lakh(latestFull.so + latestFull.wo) : "-", latestFull ? `in ${latestFull.q}` : ""],
            ["Forecast age when procurement sees it", "3–4 weeks (21–28 days)", ageDays !== null ? `${Math.round(ageDays)} days` : "-", ageDays !== null ? `median, ${Math.round(age.p90 ?? 0)} days for 9 in 10, over ${age.n} decisions` : ""],
            ["Raghav’s time on data prep", "2 days a month", "Not measured", "the system cannot see his time, so ask him monthly"],
            [`Flags raised${goLive ? ` since go-live (${goLive})` : ""}`, "-", String(tot.raised), `${tot.pending} still pending`],
            ["Approved or edited", "-", String(tot.approved + tot.edited), `${pct(tot.approved + tot.edited, decided)} of decided: ${tot.approved} as recommended, ${tot.edited} edited`],
            ["Overridden", "K3 pause line: more than 30%", String(tot.overridden), `${pct(tot.overridden, decided)} of decided`],
          ].map(([name, base, value, note]) => (
            <div key={name} className="mrow"><div>{name}</div><div className="muted">{base}</div><div><b>{value}</b> <span className="muted">{note}</span></div></div>
          ))}
        </div>
      </div>
      <p className="muted" style={{ margin: "-4px 0 0", fontSize: 13, maxWidth: 720 }}>Compare October, November and March with the same month last year, not with the previous quarter. The measured losses come from the synthetic history, so they sit in the baseline range by construction.</p>

      <div className="sectionhead">
        <h2>Losses by quarter</h2>
        <div className="row" style={{ gap: 16, fontSize: 12, color: "var(--muted)" }}>
          <span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: "var(--brand)" }} />Stockouts</span>
          <span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: "#9bb0cc" }} />Write-offs</span>
        </div>
      </div>
      <div className="card">
        <div className="bars">
          {chart.map((q) => (
            <div key={q.q} className="bar">
              <div style={{ fontSize: 12, fontWeight: 600 }}>{lakh(q.so + q.wo)}</div>
              <div className="stack"><div style={{ height: px(q.wo), background: "#9bb0cc" }} /><div style={{ height: px(q.so), background: "var(--brand)" }} /></div>
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 28, flexWrap: "nowrap", paddingTop: 10 }}>
          {chart.map((q) => <div key={q.q} className="muted" style={{ flex: 1, textAlign: "center", fontSize: 12 }}>{q.q}</div>)}
        </div>
      </div>

      <h2>Each week</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Week starting</th><th>Flags raised</th><th>Approved</th><th>Edited</th><th>Overridden</th><th>Override %</th></tr></thead>
          <tbody>{weekly.map((w) => <tr key={w.wk}><td>{dayLabel(w.wk)}</td><td>{w.raised}</td><td>{w.a}</td><td>{w.e}</td><td>{w.o}</td><td>{pct(w.o, w.a + w.e + w.o)}</td></tr>)}</tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>Only weeks with activity are listed. Raghav logs a reason for each override; see Feedback.</p>
      </div>
    </>
  );
}
