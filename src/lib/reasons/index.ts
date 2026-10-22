// One flag in, one reason out. Never throws: if anything goes wrong the template is used.
// The evaluation is read-only here. Nothing in this file can change a number or a flag.

import { checkReason } from "./check";
import { buildFacts, factsToPrompt, type ReasonContext } from "./facts";
import { GeminiError, SYSTEM_PROMPT, type TextGenerator } from "./gemini";
import { templateReason } from "./template";

export type ReasonFallback = "no_key" | "api_error" | "rate_limited" | "timeout" | "blocked" | "number_check" | "format_check";

export interface ReasonResult {
  reason: string;
  source: "ai" | "template";
  fallback: ReasonFallback | null; // why the template was used, when it was
  detail: string | null;
  ai_text: string | null; // what the AI wrote, kept even when it was thrown away
  latency_ms: number | null;
}

const clean = (t: string) => t.replace(/\s+/g, " ").trim().replace(/^["“'`]+|["”'`]+$/g, "").trim();

export async function makeReason(ctx: ReasonContext, gen: TextGenerator | null, deadline?: number): Promise<ReasonResult> {
  const template = templateReason(ctx.evaluation);
  const fallback = (kind: ReasonFallback, detail: string | null, ai_text: string | null, latency_ms: number | null): ReasonResult =>
    ({ reason: template, source: "template", fallback: kind, detail, ai_text, latency_ms });
  if (!gen) return fallback("no_key", "GEMINI_API_KEY is not set", null, null);

  const facts = buildFacts(ctx);
  const started = Date.now();
  let raw: string;
  try {
    raw = await gen({ system: SYSTEM_PROMPT, user: factsToPrompt(facts) }, deadline);
  } catch (e) {
    const kind = e instanceof GeminiError ? e.kind : "api_error";
    return fallback(kind === "no_key" ? "no_key" : kind, (e as Error).message, null, Date.now() - started);
  }
  const latency = Date.now() - started;
  const text = clean(raw);
  const verdict = checkReason(text, facts, ctx.evaluation.flag_type, ctx.evaluation.also_types.length > 0);
  if (!verdict.ok) return fallback(verdict.kind, verdict.detail, text, latency);
  return { reason: text, source: "ai", fallback: null, detail: null, ai_text: text, latency_ms: latency };
}
