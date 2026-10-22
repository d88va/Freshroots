import { getSql } from "@/lib/db/client";
import { activeFactors, eventEffect, findGaps, monthlyIndex, type MonthIndex } from "@/lib/season/learn";
import EventLog, { type EventRow } from "./EventLog";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function Calendar() {
  const sql = getSql();
  const settings = (await sql.query("select key, value from rule_settings where key in ('season_months','season_uplift','season_mode','season_gap_threshold')")) as { key: string; value: unknown }[];
  const get = <T,>(k: string) => settings.find((s) => s.key === k)!.value as T;
  const seasonMonths = get<number[]>("season_months");
  const uplift = Number(get<number>("season_uplift"));
  const mode = get<string>("season_mode");
  const threshold = Number(get<number>("season_gap_threshold"));
  const active = activeFactors(seasonMonths, uplift);

  const rows = (await sql.query("select s.category, to_char(w.week_start,'YYYY-MM-DD') as week, sum(w.units)::float8 as units from weekly_sales w join skus s using (sku_id) group by 1,2 order by 1,2")) as { category: string; week: string; units: number }[];
  const byCat: Record<string, { week: string; units: number }[]> = {};
  const totals = new Map<string, number>();
  for (const r of rows) { (byCat[r.category] ??= []).push({ week: r.week, units: r.units }); totals.set(r.week, (totals.get(r.week) ?? 0) + r.units); }
  const indexes: Record<string, MonthIndex[]> = {};
  for (const [c, s] of Object.entries(byCat)) indexes[c] = monthlyIndex(s);
  const all = monthlyIndex([...totals].map(([week, units]) => ({ week, units })));
  const gaps = findGaps(indexes, active, threshold);

  const events = ((await sql.query("select id, kind, name, to_char(start_date,'YYYY-MM-DD') as start_date, to_char(end_date,'YYYY-MM-DD') as end_date, note, logged_by from calendar_events order by start_date desc, id desc")) as EventRow[])
    .map((e) => ({ ...e, id: Number(e.id), effect: eventEffect(totals, e.start_date, e.end_date) }));

  const nowMonth = new Date().getMonth();
  const cell = (m: MonthIndex, factor: number) => {
    if (m.index === null) return <td key={m.month} className="muted" style={{ textAlign: "center" }}>n/a</td>;
    const gap = m.index - factor;
    const strength = Math.min(1, Math.abs(gap) / 0.3);
    const sharp = Math.abs(gap) + 1e-9 >= threshold;
    return (
      <td key={m.month} title={`${m.index}x a normal month, from ${m.weeks} weeks over ${m.years} years. Active factor ${factor}x.`}
        style={{ textAlign: "center", background: `color-mix(in srgb, var(${gap > 0 ? "--warn" : "--info"}) ${Math.round(strength * 55)}%, transparent)`, fontWeight: sharp ? 700 : 400 }}>
        {m.index.toFixed(2)}
      </td>
    );
  };

  return (
    <>
      <h1>Season calendar</h1>
      <p className="lead">What the rules apply today, what the history says, and the events Raghav has logged. Nothing on this page changes a rule by itself.</p>

      <h2>Active season factors</h2>
      <div className="card">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))", gap: 8 }}>
          {MONTHS.map((m, i) => (
            <div key={m} className={`pill ${active[i] !== 1 ? "warn" : ""}`} style={{ textAlign: "center", padding: "8px 4px", outline: i === nowMonth ? "2px solid var(--brand)" : "none" }}>
              <div style={{ fontWeight: 400 }}>{m}</div><div style={{ fontSize: "1.05rem" }}>{active[i].toFixed(2)}x</div>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          The case rule, nothing more: {seasonMonths.map((m) => FULL[m - 1]).join(", ")} multiply demand by {uplift} before any threshold check. Every other month is flat. Mode: <strong>{mode === "baseline" ? "uplift the 12-week baseline" : "uplift the weeks-of-stock check only"}</strong>.
          The current month is outlined. The factors are edited on the Settings page (Phase 9), by Raghav, and saved as a new rule version.
        </p>
      </div>

      <h2>What the history says</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Each cell is how busy that month has been compared with a normal month (1.00), using weekly sales in {rows.length ? Object.values(byCat)[0].length : 0} weeks of history and ignoring general growth.
        Orange means busier than the active factor allows for, purple means quieter. Bold cells differ by {threshold} or more.
      </p>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ minWidth: 720 }}>
          <thead><tr><th>Category</th>{MONTHS.map((m, i) => <th key={m} style={{ textAlign: "center", outline: i === nowMonth ? "2px solid var(--brand)" : "none" }}>{m}</th>)}</tr></thead>
          <tbody>
            <tr><td><strong>Active factor</strong></td>{active.map((f, i) => <td key={i} style={{ textAlign: "center" }}><strong>{f.toFixed(2)}</strong></td>)}</tr>
            <tr><td><strong>All categories</strong></td>{all.map((m) => cell(m, active[m.month - 1]))}</tr>
            {Object.entries(indexes).sort().map(([c, months]) => <tr key={c}><td>{c}</td>{months.map((m) => cell(m, active[m.month - 1]))}</tr>)}
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>Hover a cell to see how many weeks stand behind it. The history covers about 3 years, but each week needs half a year of data on both sides, so every month rests on about 2 years.</p>
      </div>

      <h2>Suggestions ({gaps.length})</h2>
      <p className="muted" style={{ marginTop: 0 }}>Where the history differs sharply from the active factor. These are suggestions to think about, not changes. Nothing is applied until Raghav changes a rule himself.</p>
      {gaps.length === 0 && <div className="card empty">No month differs from its active factor by {threshold} or more.</div>}
      {gaps.slice(0, 9).map((g) => (
        <div key={`${g.category}-${g.month}`} className="flagcard">
          <div className="head"><h3>{g.category} in {FULL[g.month - 1]}</h3><span className={`pill ${g.direction === "above" ? "warn" : "info"}`}>{g.direction === "above" ? "busier" : "quieter"} than the factor allows</span></div>
          <p style={{ margin: "0 0 6px" }}>
            Demand has typically run <strong>{g.index}x</strong> a normal month. The rules apply <strong>{g.active}x</strong> in {FULL[g.month - 1]} ({g.gap > 0 ? "+" : ""}{g.gap.toFixed(2)}).
            {g.direction === "below"
              ? g.active > 1
                ? ` The uplift may be too large for ${g.category}, which would hide real overstock risk and flag stockouts that are not real.`
                : ` The rules treat this month as normal, so they may over-estimate demand for ${g.category} and flag stockouts that are not real.`
              : ` The rules may be under-estimating demand for ${g.category} in this month, which would miss real stockout risk.`}
          </p>
          <div className="muted">Evidence: {g.weeks} weeks across {g.years} years. The season factor applies to every category, so weigh a change against the others before acting.</div>
        </div>
      ))}
      {gaps.length > 9 && <p className="muted">{gaps.length - 9} smaller gaps not shown. Lower the threshold (<code>season_gap_threshold</code>) to see more or raise it to see fewer.</p>}

      <h2>Event log ({events.length})</h2>
      <EventLog events={events} />
    </>
  );
}
