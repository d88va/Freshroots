import { getSql } from "@/lib/db/client";
import { loadCriteria } from "@/lib/kill/load";
import type { Status } from "@/lib/kill/criteria";
import { todayIST } from "@/lib/run/schedule";

export const dynamic = "force-dynamic";

const lakh = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `₹${(n / 100000).toFixed(1)}L`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const STYLE: Record<Status, { cls: string; label: string }> = { green: { cls: "good", label: "GREEN" }, amber: { cls: "warn", label: "AMBER" }, red: { cls: "bad", label: "RED" }, grey: { cls: "", label: "NOT YET" } };
const dayLabel = (d: unknown) => new Date(d as string).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function Metrics() {
  const sql = getSql();
  const today = todayIST();
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

  return (
    <>
      <h1>Metrics</h1>
      <p className="lead">Is it working, and should the build carry on? The kill criteria only show status. Stopping or pausing is always your decision.</p>

      <h2 style={{ marginTop: 8 }}>Kill criteria status</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ minWidth: 760 }}>
          <thead><tr><th style={{ width: 96 }}>Status</th><th>Criterion</th><th>Current value</th><th>Stop line</th></tr></thead>
          <tbody>
            {criteria.map((k) => (
              <tr key={k.id}>
                <td><span className={`pill ${STYLE[k.status].cls}`} style={{ fontSize: "0.8rem" }}>{STYLE[k.status].label}</span></td>
                <td><strong>{k.id}</strong> {k.title}<div className="muted">{k.where}</div></td>
                <td>{k.current}<ul className="muted" style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: "0.85rem" }}>{k.detail.map((d, i) => <li key={i}>{d}</li>)}</ul></td>
                <td>{k.threshold}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>The system shows these four rows and never acts on them. A red K3 puts a banner on every page suggesting a pause. The thresholds and dates are on the <a href="/settings">Settings page</a>. Grey means it cannot be measured yet.</p>
      </div>

      <h2>Baseline against what the system measures</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ minWidth: 700 }}>
          <thead><tr><th>Measure</th><th>Baseline (from the brief)</th><th>Measured</th></tr></thead>
          <tbody>
            <tr><td>Stockout losses per quarter</td><td>₹18–22L</td><td>{latestFull ? <><strong>{lakh(latestFull.so)}</strong> in {latestFull.q}<div className="muted">same quarter last year: {lakh(lastYear(latestFull.qs)?.so)}</div></> : "-"}</td></tr>
            <tr><td>Write-off losses per quarter</td><td>₹10–12L</td><td>{latestFull ? <><strong>{lakh(latestFull.wo)}</strong> in {latestFull.q}<div className="muted">same quarter last year: {lakh(lastYear(latestFull.qs)?.wo)}</div></> : "-"}</td></tr>
            <tr><td>Total demand-planning loss per quarter</td><td>₹28–34L<div className="muted">goal: recover at least 25% (₹7–8.5L a quarter)</div></td><td>{latestFull ? <><strong>{lakh(latestFull.so + latestFull.wo)}</strong> in {latestFull.q}</> : "-"}</td></tr>
            <tr><td>Forecast age when procurement sees it</td><td>3–4 weeks (21–28 days)</td><td>{ageDays !== null ? <><strong>{Math.round(ageDays)} days</strong> median, {Math.round(age.p90 ?? 0)} days for 9 in 10<div className="muted">days from the newest sales week to Raghav’s decision, over {age.n} decisions</div></> : "-"}</td></tr>
            <tr><td>Raghav’s time on data prep</td><td>2 days a month</td><td><span className="muted">Not measured. The system cannot see how long he spends, so ask him for a monthly figure.</span></td></tr>
            <tr><td>Flags raised{goLive ? ` since go-live (${goLive})` : ""}</td><td>-</td><td><strong>{tot.raised}</strong><div className="muted">{tot.pending} still pending</div></td></tr>
            <tr><td>Approved or edited</td><td>-</td><td><strong>{tot.approved + tot.edited}</strong> ({pct(tot.approved + tot.edited, decided)} of decided)<div className="muted">{tot.approved} approved as recommended, {tot.edited} edited</div></td></tr>
            <tr><td>Overridden</td><td>K3 pause line: more than 30%</td><td><strong>{tot.overridden}</strong> ({pct(tot.overridden, decided)} of decided)</td></tr>
          </tbody>
        </table>
        <p className="notice" style={{ margin: "12px 0 0" }}>
          <strong>Compare festival months with the same month last year, not with the previous quarter.</strong> October, November and March run busier by design, so a loss in Q4 is compared with Q4 last year.
          The measured losses here come from the synthetic history, so they sit in the baseline range by construction.
        </p>
      </div>

      <h2>Losses by quarter</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Quarter</th><th>Stockouts</th><th>Write-offs</th><th>Total</th><th>Same quarter last year</th><th>Change</th></tr></thead>
          <tbody>
            {quarters.slice(0, 6).map((q) => {
              const prev = lastYear(q.qs), tot2 = q.so + q.wo, p2 = prev ? prev.so + prev.wo : null;
              const partial = isPartial(q.qs);
              return (
                <tr key={q.q}>
                  <td>{q.q}{partial && <span className="pill warn" style={{ marginLeft: 6 }}>part quarter</span>}{goLive && q.qs >= goLive.slice(0, 7) + "-01" && !partial ? <span className="pill info" style={{ marginLeft: 6 }}>live</span> : null}</td>
                  <td>{lakh(q.so)}</td><td>{lakh(q.wo)}</td><td><strong>{lakh(tot2)}</strong></td>
                  <td>{p2 ? lakh(p2) : <span className="muted">no data</span>}</td>
                  <td>{p2 && !partial ? `${tot2 >= p2 ? "+" : ""}${Math.round(((tot2 - p2) / p2) * 100)}%` : <span className="muted">-</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Each week (the weekly rhythm)</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Week starting</th><th>Flags raised</th><th>Approved</th><th>Edited</th><th>Overridden</th><th>Override %</th></tr></thead>
          <tbody>{weekly.map((w) => <tr key={w.wk}><td>{dayLabel(w.wk)}</td><td>{w.raised}</td><td>{w.a}</td><td>{w.e}</td><td>{w.o}</td><td>{pct(w.o, w.a + w.e + w.o)}</td></tr>)}</tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>Only weeks with activity are listed. Raghav logs a reason for each override; see the Feedback page.</p>
      </div>
    </>
  );
}
