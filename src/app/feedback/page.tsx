import Link from "next/link";
import { getSql } from "@/lib/db/client";
import { monthName, ruleOf } from "@/lib/feedback/analysis";
import { TAG_LABELS, TAGS, type Tag } from "@/lib/review/decide";
import { RULE_LABELS } from "@/lib/rules/settings";
import CheckButton from "./CheckButton";
import SuggestionCard, { type SuggestionView } from "./SuggestionCard";

export const dynamic = "force-dynamic";

const ist = (d: unknown, o: Intl.DateTimeFormatOptions) => new Date(d as string).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...o });
const lakh = (n: number) => `₹${(n / 100000).toFixed(1)}L`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));

interface Row { id: number; flag_type: string; window_type: string; status: string; tag: string | null; category: string; rating: string | null; source: string | null; kind: string | null; result: string | null }
interface Sug { id: number; dedupe_key: string; rule_key: string; text: string; evidence: SuggestionView["evidence"] & Record<string, unknown>; proposal: SuggestionView["proposal"]; status: string; resolved_at: string | null; resolution: { reason?: string; version_id?: number; changes?: Record<string, unknown> } | null }

export default async function Feedback({ searchParams }: { searchParams: { month?: string } }) {
  const sql = getSql();
  const months = ((await sql.query("select distinct to_char(decided_at at time zone 'Asia/Kolkata','YYYY-MM') as m from flags where status <> 'pending' order by 1 desc")) as { m: string }[]).map((r) => r.m);
  const month = searchParams.month && months.includes(searchParams.month) ? searchParams.month : months[0];

  const settings = Object.fromEntries(((await sql.query("select key, value from rule_settings")) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const suggestions = ((await sql.query("select id, dedupe_key, rule_key, text, evidence, proposal, status, resolved_at, resolution from suggestions order by id desc")) as Sug[]).map((s) => ({ ...s, id: Number(s.id) }));
  const open = suggestions.filter((s) => s.status === "open");
  const handled = suggestions.filter((s) => s.status !== "open");
  const versions = (await sql.query("select id, saved_at, saved_by, changes, reason from rule_versions order by id desc limit 8")) as { id: number; saved_at: string; saved_by: string; changes: Record<string, { from: unknown; to: unknown }>; reason: string }[];
  const [lastCheck] = (await sql.query("select max(checked_at) as t, count(*)::int as n from outcomes")) as { t: string | null; n: number }[];

  let rows: Row[] = [];
  let misses: { detail: { sku_id: string; type: string; week_start: string; value_inr: number } }[] = [];
  if (month) {
    rows = ((await sql.query(
      `select f.id, f.flag_type, f.numbers->>'window_type' as window_type, f.status, f.decision_tag as tag, s.category, f.reason_rating as rating, f.reason_source as source, o.kind, o.result
         from flags f join skus s using (sku_id) left join outcomes o on o.flag_id = f.id
        where f.status <> 'pending' and to_char(f.decided_at at time zone 'Asia/Kolkata','YYYY-MM') = $1`, [month])) as Row[]);
    misses = (await sql.query("select detail from outcomes where kind = 'miss' and detail->>'week_start' like $1 order by (detail->>'value_inr')::numeric desc", [`${month}%`])) as typeof misses;
  }
  const trend = (await sql.query(
    `select to_char(f.decided_at at time zone 'Asia/Kolkata','YYYY-MM') as m, count(*)::int as n, count(*) filter (where f.status = 'overridden')::int as over,
            count(*) filter (where o.result = 'raghav_right')::int as right, count(*) filter (where o.result = 'raghav_wrong')::int as wrong
       from flags f left join outcomes o on o.flag_id = f.id where f.status <> 'pending' group by 1 order by 1 desc limit 6`)) as { m: string; n: number; over: number; right: number; wrong: number }[];

  // Aggregate the selected month
  const total = rows.length, over = rows.filter((r) => r.status === "overridden");
  const checked = over.filter((r) => r.kind === "override_check");
  const right = checked.filter((r) => r.result === "raghav_right").length;
  const byRule = new Map<string, { label: string; n: number; over: number; right: number; wrong: number; tags: Map<string, number> }>();
  for (const r of rows) {
    const rule = ruleOf({ flag_type: r.flag_type, window_type: r.window_type });
    const a = byRule.get(rule.key) ?? { label: rule.label, n: 0, over: 0, right: 0, wrong: 0, tags: new Map() };
    a.n++;
    if (r.status === "overridden") { a.over++; if (r.result === "raghav_right") a.right++; if (r.result === "raghav_wrong") a.wrong++; if (r.tag) a.tags.set(r.tag, (a.tags.get(r.tag) ?? 0) + 1); }
    byRule.set(rule.key, a);
  }
  const byCat = new Map<string, { n: number; over: number }>();
  for (const r of rows) { const a = byCat.get(r.category) ?? { n: 0, over: 0 }; a.n++; if (r.status === "overridden") a.over++; byCat.set(r.category, a); }
  const ended = rows.filter((r) => r.kind === "approved_end_state");
  const endCount = (x: string) => ended.filter((r) => r.result === x).length;
  const rated = (src: string, v: string) => rows.filter((r) => r.source === src && r.rating === v).length;
  const view = (s: Sug): SuggestionView => ({
    id: s.id, kind: s.dedupe_key.startsWith("tag:") ? "tag" : "override_rate", rule_key: s.rule_key, text: s.text, evidence: s.evidence, proposal: s.proposal,
    title: s.dedupe_key.startsWith("tag:") ? `“${TAG_LABELS[s.evidence.tag as unknown as Tag] ?? s.evidence.tag}” in ${monthName(String(s.evidence.month))}` : `${String(s.evidence.rule_label)}, ${monthName(String(s.evidence.month))}`,
  });
  const ruleCards = open.filter((s) => s.dedupe_key.startsWith("override:")).sort((a, b) => Number(b.evidence.overrides) - Number(a.evidence.overrides));
  const tagCards = open.filter((s) => s.dedupe_key.startsWith("tag:")).sort((a, b) => Number(b.evidence.decisions) - Number(a.evidence.decisions));

  return (
    <>
      <h1>Feedback</h1>
      <p className="lead">What Raghav’s decisions say about the rules. The system only suggests. A rule changes only when Raghav accepts or edits a suggestion, or edits it on the Settings page.</p>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="muted">Outcome check</div>
            <div>Runs every day at 7:30 am IST on decisions that are 28 or more days old.</div>
            <div className="muted">{lastCheck?.t ? `${lastCheck.n} outcomes recorded, latest ${ist(lastCheck.t, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} IST` : "No outcomes recorded yet."}</div>
          </div>
          <CheckButton />
        </div>
      </div>

      <h2>Suggestions waiting for Raghav ({open.length})</h2>
      {open.length === 0 && <div className="card empty">No open suggestions.{handled.length ? " See what has been handled below." : ""}</div>}
      {ruleCards.length > 0 && <><h3 style={{ margin: "12px 0 8px" }}>Rules that are overridden often ({ruleCards.length})</h3>{ruleCards.map((s) => <SuggestionCard key={s.id} s={view(s)} current={settings} />)}</>}
      {tagCards.length > 0 && <><h3 style={{ margin: "16px 0 8px" }}>Reasons that keep recurring ({tagCards.length})</h3>{tagCards.map((s) => <SuggestionCard key={s.id} s={view(s)} current={settings} />)}</>}

      {handled.length > 0 && (
        <>
          <h2>Handled suggestions ({handled.length})</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Suggestion</th><th>Outcome</th><th>Raghav’s reason</th></tr></thead>
              <tbody>{handled.map((s) => (
                <tr key={s.id}>
                  <td>{s.text.slice(0, 120)}{s.text.length > 120 ? "…" : ""}</td>
                  <td><span className={`pill ${s.status === "dismissed" ? "" : "good"}`}>{s.status}</span>{s.resolution?.version_id ? <div className="muted">rule version {s.resolution.version_id}</div> : null}</td>
                  <td>{s.resolution?.reason || <span className="muted">-</span>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>
      )}

      <h2>Rule versions</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Version</th><th>Saved</th><th>By</th><th>Change</th><th>Reason</th></tr></thead>
          <tbody>{versions.map((v) => (
            <tr key={v.id}>
              <td>{v.id}</td><td>{ist(v.saved_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td><td>{v.saved_by}</td>
              <td>{Object.entries(v.changes).map(([k, c]) => (c && typeof c === "object" && "to" in c) ? <div key={k}>{RULE_LABELS[k] ?? k}: <strong>{show(c.from)} → {show(c.to)}</strong></div> : <div key={k} className="muted">initial defaults</div>)}</td>
              <td>{v.reason}</td>
            </tr>))}</tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>Every run records the version it used (see Runs). The Settings page, where Raghav edits any rule directly, comes in Phase 9.</p>
      </div>

      {month && (
        <>
          <div className="sectionhead">
            <h2>Monthly summary: {monthName(month)}</h2>
            <div className="pills" style={{ margin: 0 }}>{months.map((m) => <Link key={m} href={`/feedback?month=${m}`} className={`pill ${m === month ? "info" : ""}`} style={{ textDecoration: "none" }}>{monthName(m).slice(0, 3)} {m.slice(2, 4)}</Link>)}</div>
          </div>
          <div className="pills">
            <span className="pill">{total} decided</span>
            <span className="pill warn">{over.length} overridden ({pct(over.length, total)})</span>
            <span className="pill good">Raghav right on {right} of {checked.length} checked overrides ({pct(right, checked.length)})</span>
            <span className="pill bad">{misses.length} misses{misses.length ? ` (${lakh(misses.reduce((a, m) => a + Number(m.detail.value_inr), 0))})` : ""}</span>
            <span className="pill info">AI reasons: 👍 {rated("ai", "up")} / 👎 {rated("ai", "down")}</span>
            <span className="pill">Template reasons: 👍 {rated("template", "up")} / 👎 {rated("template", "down")}</span>
          </div>

          <div className="card" style={{ overflowX: "auto" }}>
            <strong>By rule</strong>
            <table>
              <thead><tr><th>Rule</th><th>Flags decided</th><th>Overridden</th><th>Raghav right</th><th>Raghav wrong</th><th>Most common reason</th></tr></thead>
              <tbody>{[...byRule.values()].sort((a, b) => b.over - a.over).map((r) => {
                const t = [...r.tags].sort((a, b) => b[1] - a[1])[0];
                return <tr key={r.label}><td>{r.label}</td><td>{r.n}</td><td>{r.over} ({pct(r.over, r.n)})</td><td>{r.right}</td><td>{r.wrong}</td><td>{t ? `${TAG_LABELS[t[0] as Tag]} (${t[1]})` : <span className="muted">-</span>}</td></tr>;
              })}</tbody>
            </table>
            <p className="muted" style={{ marginBottom: 0 }}>“Right” and “wrong” are only about overrides: did the feared stockout or write-off happen anyway in the next 4 weeks? For approved orders the system records only where the stock ended up, because the order itself changed what happened.</p>
          </div>

          <div className="card" style={{ overflowX: "auto" }}>
            <strong>By reason tag</strong>
            <table>
              <thead><tr><th>Tag</th><th>On overrides</th><th>On approved or edited</th></tr></thead>
              <tbody>
                {TAGS.map((t) => <tr key={t}><td>{TAG_LABELS[t]}</td><td>{rows.filter((r) => r.tag === t && r.status === "overridden").length}</td><td>{rows.filter((r) => r.tag === t && r.status !== "overridden").length}</td></tr>)}
                <tr><td className="muted">No tag</td><td>{over.filter((r) => !r.tag).length}</td><td>{rows.filter((r) => !r.tag && r.status !== "overridden").length}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="card" style={{ overflowX: "auto" }}>
            <strong>By category</strong>
            <table>
              <thead><tr><th>Category</th><th>Flags decided</th><th>Overridden</th></tr></thead>
              <tbody>{[...byCat].sort((a, b) => b[1].over - a[1].over).map(([c, a]) => <tr key={c}><td>{c}</td><td>{a.n}</td><td>{a.over} ({pct(a.over, a.n)})</td></tr>)}</tbody>
            </table>
          </div>

          <div className="card">
            <strong>Where approved orders ended up (4 weeks later)</strong>
            <div className="pills" style={{ marginTop: 8 }}>
              <span className="pill good">Back in the healthy band: {endCount("healthy")}</span>
              <span className="pill bad">Still too low: {endCount("still_low")}</span>
              <span className="pill warn">Still too high: {endCount("still_high")}</span>
              {endCount("unknown") > 0 && <span className="pill">Unknown: {endCount("unknown")}</span>}
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>Described, not judged. These flags were approved, so the order changed what happened.</p>
          </div>

          {misses.length > 0 && (
            <div className="card" style={{ overflowX: "auto" }}>
              <strong>Misses ({misses.length}): losses on SKUs with no flag in the 4 weeks before</strong>
              <table>
                <thead><tr><th>SKU</th><th>Loss</th><th>Week</th><th>Value</th></tr></thead>
                <tbody>{misses.slice(0, 8).map((m, i) => <tr key={i}><td>{m.detail.sku_id}</td><td>{m.detail.type === "stockout" ? "Stockout" : "Write-off"}</td><td>{m.detail.week_start}</td><td>{lakh(Number(m.detail.value_inr))}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      <h2>Month by month</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Month</th><th>Flags decided</th><th>Overridden</th><th>Raghav right</th><th>Raghav wrong</th></tr></thead>
          <tbody>{trend.map((t) => <tr key={t.m}><td>{monthName(t.m)}</td><td>{t.n}</td><td>{t.over} ({pct(t.over, t.n)})</td><td>{t.right}</td><td>{t.wrong}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
