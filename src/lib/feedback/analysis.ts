// The feedback loop's thinking, as pure functions: which rule a flag belongs to, what a threshold change would have done
// to past decisions, and when a suggestion is raised. Nothing here changes a rule. It only drafts suggestions for Raghav.

import type { RuleSettings } from "../rules/engine";
import { TAG_LABELS, type Tag } from "../review/decide";

export interface RuleRef { key: string; label: string; setting: keyof RuleSettings | null; side: "below" | "above" | null; step: number }

/** Which rule a flag belongs to, for counting overrides. A flag that is both high demand and stockout counts as high demand. */
export function ruleOf(f: { flag_type: string; window_type: string; triggers?: string[] }): RuleRef {
  const perishable = f.window_type === "perishable";
  switch (f.flag_type) {
    case "stockout_risk":
      return perishable
        ? { key: "perishable_stockout", label: "Perishable window (minimum stock)", setting: "perishable_min_weeks", side: "below", step: 0.5 }
        : { key: "standard_stockout", label: "Stockout risk (6-week rule)", setting: "stockout_weeks", side: "below", step: 0.5 };
    case "overstock_risk":
      return perishable
        ? { key: "perishable_overstock", label: "Perishable window (maximum stock)", setting: "perishable_max_weeks", side: "above", step: 0.5 }
        : { key: "standard_overstock", label: "Overstock risk (14-week rule)", setting: "overstock_weeks", side: "above", step: 1 };
    case "high_demand":
      return { key: "high_demand", label: "High demand (20% rule)", setting: "high_demand_pct", side: "above", step: 5 };
    default:
      return { key: "needs_judgment", label: "Needs judgment", setting: null, side: null, step: 0 };
  }
}

/** The figure the rule compared against its threshold: weeks of stock, or % above the baseline for high demand. */
export function flagValue(rule: RuleRef, n: { weeks_of_stock: number | null; avg_recent: number; demand_baseline: number }): number | null {
  if (rule.key === "high_demand") return n.demand_baseline > 0 ? Math.round(((n.avg_recent / n.demand_baseline) - 1) * 1000) / 10 : null;
  return n.weeks_of_stock;
}

export interface Proposal { key: keyof RuleSettings; from: unknown; to: unknown; what_if?: { overrides_stopped: number; overrides_total: number; approved_lost: number; approved_total: number } }

/**
 * What the mildest threshold change would have done to the decisions seen so far: the smallest step that would have
 * stopped at least half the overridden flags from firing, and what it would also have stopped among the ones Raghav kept.
 * Returns null when no reasonable change would help (or there is nothing overridden).
 */
export function proposeThreshold(rule: RuleRef, current: number, rows: { value: number; overridden: boolean }[], minShare = 0.5): Proposal | null {
  if (!rule.setting || !rule.side) return null;
  const over = rows.filter((r) => r.overridden), kept = rows.filter((r) => !r.overridden);
  if (!over.length) return null;
  const stops = (r: { value: number }, t: number) => (rule.side === "below" ? r.value >= t : r.value <= t); // would no longer fire
  for (let k = 1; k <= 12; k++) {
    const t = Number((current + (rule.side === "below" ? -1 : 1) * k * rule.step).toFixed(2));
    if (t <= 0) break;
    const stopped = over.filter((r) => stops(r, t)).length;
    if (stopped / over.length >= minShare) {
      return { key: rule.setting, from: current, to: t, what_if: { overrides_stopped: stopped, overrides_total: over.length, approved_lost: kept.filter((r) => stops(r, t)).length, approved_total: kept.length } };
    }
  }
  return null;
}

export interface DecidedFlag {
  id: number; rule: RuleRef; value: number | null; status: "approved" | "edited" | "overridden";
  tag: Tag | null; month: string; category: string; check: "raghav_right" | "raghav_wrong" | null;
}

export interface Draft {
  dedupe_key: string; kind: "override_rate" | "tag"; rule_key: string; month: string; text: string;
  proposal: Proposal | null; evidence: Record<string, unknown>;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const top = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1])[0];
const count = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };

export interface DraftOptions { overrideThreshold: number; tagThreshold: number; settings: RuleSettings }

/** The suggestions the decisions in one month call for. Rules overridden often get one; so does a reason tag that keeps coming back. */
export function draftSuggestions(flags: DecidedFlag[], month: string, o: DraftOptions): Draft[] {
  const inMonth = flags.filter((f) => f.month === month);
  const out: Draft[] = [];

  // 1. A rule overridden many times in the month
  const byRule = new Map<string, DecidedFlag[]>();
  for (const f of inMonth) byRule.set(f.rule.key, [...(byRule.get(f.rule.key) ?? []), f]);
  for (const [ruleKey, all] of byRule) {
    const over = all.filter((f) => f.status === "overridden");
    if (over.length < o.overrideThreshold) continue;
    const rule = all[0].rule;
    const tags = count(over.map((f) => f.tag ?? "none"));
    const [topTag, topTagN] = top(tags)!;
    const current = rule.setting ? Number(o.settings[rule.setting]) : null;
    const rows = all.filter((f) => f.value !== null).map((f) => ({ value: f.value as number, overridden: f.status === "overridden" }));
    const proposal = current === null ? null : proposeThreshold(rule, current, rows);
    const checked = over.filter((f) => f.check);
    const right = checked.filter((f) => f.check === "raghav_right").length;
    const rate = Math.round((over.length / all.length) * 100);
    let text = `${rule.label} was overridden ${over.length} times in ${monthName(month)} (${rate}% of its ${all.length} flags).`;
    if (topTag !== "none") text += ` Most common reason: ${TAG_LABELS[topTag as Tag]} (${topTagN} of ${over.length}).`;
    if (proposal?.what_if) text += ` Changing ${String(proposal.key)} from ${String(proposal.from)} to ${String(proposal.to)} would have stopped ${proposal.what_if.overrides_stopped} of the ${proposal.what_if.overrides_total} overridden flags, and also ${proposal.what_if.approved_lost} of the ${proposal.what_if.approved_total} you kept.`;
    out.push({
      dedupe_key: `override:${ruleKey}:${month}`, kind: "override_rate", rule_key: rule.setting ?? ruleKey, month, text, proposal,
      evidence: { rule: ruleKey, rule_label: rule.label, month, flags: all.length, overrides: over.length, rate, tags: Object.fromEntries(tags), categories: Object.fromEntries(count(over.map((f) => f.category))), checked: checked.length, raghav_right: right, raghav_wrong: checked.length - right },
    });
  }

  // 2. The same reason tag coming back again and again
  const tagged = inMonth.filter((f) => f.tag);
  for (const [tag, n] of count(tagged.map((f) => f.tag as string))) {
    if (n < o.tagThreshold) continue;
    const withTag = tagged.filter((f) => f.tag === tag);
    const [topRule, topRuleN] = top(count(withTag.map((f) => f.rule.label)))!;
    const monthNo = Number(month.slice(5, 7));
    let proposal: Proposal | null = null;
    if (tag === "season_missed" && !o.settings.season_months.includes(monthNo)) {
      proposal = { key: "season_months", from: o.settings.season_months, to: [...o.settings.season_months, monthNo].sort((a, b) => a - b) };
    }
    let text = `"${TAG_LABELS[tag as Tag]}" was the reason on ${n} decisions in ${monthName(month)}, mostly on ${topRule} (${topRuleN}).`;
    if (proposal) text += ` If this month really is busier, adding ${MONTH_NAMES[monthNo - 1]} to the season months would apply the ${o.settings.season_uplift}x uplift to every category.`;
    out.push({
      dedupe_key: `tag:${tag}:${month}`, kind: "tag", rule_key: proposal ? "season_months" : tag, month, text, proposal,
      evidence: { tag, month, decisions: n, overrides: withTag.filter((f) => f.status === "overridden").length, rules: Object.fromEntries(count(withTag.map((f) => f.rule.label))), categories: Object.fromEntries(count(withTag.map((f) => f.category))) },
    });
  }
  return out;
}
