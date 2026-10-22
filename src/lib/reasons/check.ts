// The number check and the format check. A reason that fails either is thrown away and the template is used.
// This is what keeps the AI from changing, adding or inventing anything.

import type { FlagType } from "../rules/engine";
import { allowedNumbers, extractNumbers, type Facts } from "./facts";

export type CheckResult = { ok: true } | { ok: false; kind: "number_check" | "format_check"; detail: string };

// Numbers written as words slip past a digit check ("six weeks"), so they are rejected too.
const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|hundred|thousand|lakh|million|dozen|once|twice|double|triple|half|quarter)\b/i;

// Words that would contradict the flag the code already decided.
const CONTRADICTS: Partial<Record<FlagType, RegExp>> = {
  stockout_risk: /overstock|excess stock|too much stock|pause/i,
  overstock_risk: /stockout|run out|running out|running low|shortage|reorder/i,
  high_demand: /overstock|pause/i,
  needs_judgment: /reorder|recommend|should order|order \d/i,
};

export function checkReason(text: string, facts: Facts, flag: FlagType, hasSecondFlag: boolean): CheckResult {
  if (text.length < 20 || text.length > 280) return { ok: false, kind: "format_check", detail: `length ${text.length}` };
  if (/[\n\r*#`_|]/.test(text)) return { ok: false, kind: "format_check", detail: "line breaks or markdown" };
  if (/[.!?]\s+\S/.test(text.replace(/\d\.\d/g, ""))) return { ok: false, kind: "format_check", detail: "more than one sentence" };
  if (/(has|have) been (ordered|placed|approved|sent)/i.test(text)) return { ok: false, kind: "format_check", detail: "claims an order was placed" };

  const allowed = allowedNumbers(facts);
  const bad = extractNumbers(text).filter((x) => !allowed.some((a) => Math.abs(a - x) < 1e-9));
  if (bad.length) return { ok: false, kind: "number_check", detail: `figure(s) not in the input: ${bad.join(", ")}` };
  const word = text.match(NUMBER_WORDS);
  if (word) return { ok: false, kind: "number_check", detail: `number written as a word: "${word[0]}"` };

  const contradiction = hasSecondFlag ? null : CONTRADICTS[flag]; // two-flag cases legitimately mention both sides
  if (contradiction && contradiction.test(text)) return { ok: false, kind: "format_check", detail: "wording contradicts the flag" };
  return { ok: true };
}
