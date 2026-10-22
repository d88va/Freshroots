import { getSql } from "@/lib/db/client";
import type { BtSummary } from "@/lib/backtest/replay";
import RunButton from "./RunButton";

export const dynamic = "force-dynamic";

const lakh = (n: number) => `₹${(n / 100000).toFixed(1)}L`;
const label: Record<string, string> = { stockout: "Stockouts", write_off: "Write-offs", perishable: "Perishable SKUs", non_perishable: "Other SKUs" };

function Group({ title, rows }: { title: string; rows: BtSummary["by_type"] }) {
  return (
    <div className="card">
      <strong>{title}</strong>
      <table>
        <thead><tr><th></th><th>Losses</th><th>Flagged before</th><th>Share</th><th>₹ flagged before</th></tr></thead>
        <tbody>
          {Object.entries(rows).sort().map(([k, g]) => (
            <tr key={k}>
              <td>{label[k] ?? k}</td>
              <td>{g.events.toLocaleString()}</td>
              <td>{g.caught.toLocaleString()}</td>
              <td>{g.events ? ((g.caught / g.events) * 100).toFixed(0) : 0}%</td>
              <td>{lakh(g.caught_value)} of {lakh(g.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function Backtest() {
  const sql = getSql();
  const [row] = (await sql.query("select run_at, summary from backtest_results order by id desc limit 1")) as { run_at: string; summary: BtSummary }[];
  const s = row?.summary;
  const skuCount = ((await sql.query("select count(*)::int as n from skus")) as { n: number }[])[0].n;
  const stopLine = Number(((await sql.query("select value from rule_settings where key = 'k2_min_catch_pct'")) as { value: number }[])[0]?.value ?? 50);

  if (!s) {
    return (
      <>
        <h1>Backtest</h1>
        <p className="lead">Kill switch K2: would the rules have caught past stockouts and write-offs?</p>
        <div className="card"><p>No backtest has been run yet.</p><RunButton /></div>
      </>
    );
  }
  const red = s.caught_pct < stopLine;
  const busy = skuCount ? (s.flag_load.avg_flags_per_run / skuCount) * 100 : 0;
  const lead = s.lead_weeks;

  return (
    <>
      <h1>Backtest</h1>
      <p className="lead">Kill switch K2: replay the rules over 3 years of history. Would they have flagged each past stockout and write-off before it happened?</p>

      <div className="card">
        <div style={{ fontSize: "2.4rem", fontWeight: 700, color: `var(${red ? "--bad" : "--good"})` }}>{s.caught_pct}%</div>
        <div>
          of {s.events_tested.toLocaleString()} past stockouts and write-offs were flagged at least {s.params.min_lead_weeks} week before they happened
          (within {s.params.lookback_weeks} weeks). That is <strong>{s.value_caught_pct}% of the rupees</strong> ({lakh(s.value_caught_inr)} of {lakh(s.value_tested_inr)}).
        </div>
        <p style={{ marginBottom: 0 }} className={red ? "err" : "ok"}>
          {red
            ? `RED. Below the ${stopLine}% stop line. This is the K2 signal: stop and re-document the rules with Raghav.`
            : `Green. Above the ${stopLine}% stop line (K2 is not triggered). Read the two numbers below before trusting it.`}
        </p>
      </div>

      <h2>Is that number meaningful?</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          A rule that flags nearly every SKU every week would also “catch” nearly every loss. So the headline has to be read next to these two checks:
        </p>
        <table>
          <tbody>
            <tr><td>Chance baseline</td><td><strong>{s.chance.caught_pct}%</strong></td><td className="muted">What random SKUs of the same kind would have scored in the same weeks. The rules are {s.chance.lift}x better than chance (stockouts: chance {s.chance.stockout_pct}%, write-offs: chance {s.chance.write_off_pct}%).</td></tr>
            <tr><td>Flag load</td><td><strong>{s.flag_load.avg_flags_per_run}</strong> per run</td><td className={busy > 25 ? "err" : "muted"}>{busy.toFixed(0)}% of {skuCount} SKUs flagged in an average run ({s.flag_load.avg_by_type.stockout_risk} stockout, {s.flag_load.avg_by_type.overstock_risk} overstock, {s.flag_load.avg_by_type.high_demand} high demand, {s.flag_load.avg_by_type.needs_judgment} judgment).{busy > 25 ? " That is a lot for one person to review." : ""}</td></tr>
            <tr><td>Flags followed by a loss</td><td><strong>{s.flag_hit_rate.stockout_flags_followed_pct}%</strong> / <strong>{s.flag_hit_rate.overstock_flags_followed_pct}%</strong></td><td className="muted">Stockout flags / overstock flags that were followed by a real loss within {s.params.lookback_weeks} weeks. Low is expected for stockout flags: the point is that someone reorders, so the loss does not happen.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Twice a week against a monthly cycle</h2>
      <div className="card">
        <p style={{ margin: 0 }}>
          Running the same rules only on the first Monday of each month would have flagged <strong>{s.monthly_cycle.caught_pct}%</strong>, against <strong>{s.caught_pct}%</strong> running every week.{" "}
          {s.lead_weeks.caught_only_by_weekly.toLocaleString()} losses were caught only because the rules run more often. Where both caught a loss, the weekly run flagged it a median of{" "}
          <strong>{lead.earlier_by_median ?? "n/a"} week(s) earlier</strong> (median warning time: {lead.weekly_median ?? "n/a"} weeks weekly, {lead.monthly_median ?? "n/a"} weeks monthly). The monthly side is generous to the old process: it uses fresh data, while the real forecast is 3–4 weeks old.
        </p>
      </div>

      <h2>Where it works and where it does not</h2>
      <Group title="By kind of loss" rows={s.by_type} />
      <Group title="Perishable or not" rows={s.by_perishable} />
      <Group title="By year" rows={s.by_year} />

      <h2>Largest examples</h2>
      <div className="card">
        <table>
          <thead><tr><th>SKU</th><th>Loss</th><th>Week</th><th>Value</th><th>First flagged</th><th>Warning</th></tr></thead>
          <tbody>
            {s.examples.caught.map((e, i) => (
              <tr key={"c" + i}><td>{e.sku_id}</td><td>{label[e.type] ?? e.type}</td><td>{e.event_week}</td><td>{lakh(e.value_inr)}</td><td>{e.first_flag}</td><td className="ok">{e.lead_weeks} weeks ahead</td></tr>
            ))}
            {s.examples.missed.map((e, i) => (
              <tr key={"m" + i}><td>{e.sku_id}</td><td>{label[e.type] ?? e.type}</td><td>{e.event_week}</td><td>{lakh(e.value_inr)}</td><td>-</td><td className="err">not flagged</td></tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>The first six are the biggest losses the rules caught, the next six the biggest they missed.</p>
      </div>

      <h2>How to read this</h2>
      <div className="notice">
        <strong>This is synthetic data.</strong> The history is generated, so this run proves the machinery works, not that Raghav’s rules work at Freshroots.
        The number that counts comes from real SAP exports dropped onto the Upload page; then press the button below.
      </div>
      <div className="card muted">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>Every Monday from {s.first_run_date} (the first week every SKU had 12 weeks of history) to {s.last_run_date}, the rules were run on the stock and sales known that day: {s.runs} runs.</li>
          <li>A stockout counts as caught if a stockout-risk or high-demand flag was raised in the {s.params.lookback_weeks} weeks before it (at least {s.params.min_lead_weeks} week before). A write-off counts if an overstock flag was raised.</li>
          <li>{s.events_not_testable.toLocaleString()} early losses were left out because the rules had no 12-week history yet. Needs-judgment flags are not counted as catches ({s.surfaced_for_judgment} losses were missed by the rules but did land on Raghav’s judgment list).</li>
          <li>The window sizes are settings (<code>backtest_lookback_weeks</code>, <code>backtest_min_lead_weeks</code>). The Thursday run uses the same weekly data, so replaying every Monday gives the same answer as twice a week.</li>
          <li>The replay uses the rules saved today. It changes no rules and no flags.</li>
        </ul>
      </div>
      <p className="muted">Last run {new Date(row.run_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.</p>
      <RunButton />
    </>
  );
}
