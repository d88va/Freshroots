// Gemini Flash client: one flag in, one sentence out. It is only ever asked to WRITE a reason.
// Rate-limit pacing: calls are made one at a time, at least 60/RPM seconds apart, and a 429 is retried
// after the wait Google asks for (within the caller's deadline). The key comes from the environment.

export type GeminiErrorKind = "no_key" | "api_error" | "rate_limited" | "timeout" | "blocked";
export class GeminiError extends Error {
  constructor(public kind: GeminiErrorKind, message: string) { super(message); }
}

export interface PromptParts { system: string; user: string }
/** deadline is an absolute time in ms (Date.now() scale). Retries stop when it would be passed. */
export type TextGenerator = (p: PromptParts, deadline?: number) => Promise<string>;

export const SYSTEM_PROMPT = `You write one-line explanations for a demand planner at a snack and staples distributor in India.
You are given the facts about one flag that a rules engine has ALREADY decided. Explain why it fired.
Rules you must follow:
- Write exactly ONE plain sentence, under 30 words, no line breaks, no markdown.
- Use only figures that appear in the facts, copied exactly (for example 550.75, not 551). Never calculate, round, convert or add a figure. Do not write numbers as words.
- Do not change, question or add to the flag, and do not suggest any action other than recommended_action.
- Never say an order has been placed or approved. A person decides that.
- Mention the two or three figures that matter most to the decision. If "Also true" lists another condition, or the flag is urgent, say so briefly.
- Write in everyday words. Never use field names or underscores, and do not mention the word "flag"; say "stockout risk", "overstock" or "high demand" in plain language.`;

// Reasons are one short sentence, so thinking is switched down to keep each call quick.
function thinking(model: string) {
  if (/2\.5/.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  if (/gemini-3/.test(model)) return { thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING_LEVEL || "minimal" } };
  return {};
}

export interface GeminiOptions {
  apiKey: string | undefined;
  model?: string;
  rpm?: number; // requests per minute to stay under (free tier Flash is about 10)
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function createGemini(o: GeminiOptions): TextGenerator | null {
  if (!o.apiKey) return null;
  const model = o.model ?? "gemini-3.5-flash"; // 2.5 Flash is closed to new keys; 3.5 Flash answers in about 1.4s
  const gap = Math.ceil(60000 / (o.rpm ?? 8));
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs ?? 12000;
  const maxRetries = o.maxRetries ?? 2;
  let nextSlot = 0;
  let chain: Promise<unknown> = Promise.resolve();

  async function callOnce(p: PromptParts): Promise<string> {
    // One at a time, spaced out
    const wait = Math.max(0, nextSlot - now());
    if (wait) await sleep(wait);
    nextSlot = now() + gap;

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: p.system }] },
      contents: [{ role: "user", parts: [{ text: p.user }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 200, ...thinking(model) },
    };
    let res: Response;
    try {
      res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": o.apiKey! }, // key in a header, never in the URL
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const name = (e as Error).name;
      throw new GeminiError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "api_error", (e as Error).message);
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const err = new GeminiError("rate_limited", "Gemini rate limit reached");
      (err as GeminiError & { retryAfterMs?: number }).retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
      throw err;
    }
    if (!res.ok) {
      let why = "";
      try { why = ((await res.json()) as { error?: { message?: string } }).error?.message?.slice(0, 160) ?? ""; } catch { /* no body */ }
      throw new GeminiError("api_error", `Gemini returned ${res.status}${why ? `: ${why}` : ""}`);
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
    const cand = json.candidates?.[0];
    if (json.promptFeedback?.blockReason || cand?.finishReason === "SAFETY") throw new GeminiError("blocked", "Gemini blocked the answer");
    const text = cand?.content?.parts?.map((x) => x.text ?? "").join("").trim();
    if (!text) throw new GeminiError("api_error", "Gemini returned no text");
    return text;
  }

  const generate: TextGenerator = (p, deadline) => {
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await callOnce(p);
        } catch (e) {
          const err = e as GeminiError & { retryAfterMs?: number };
          const retryable = err.kind === "rate_limited" || (err.kind === "api_error" && /returned 5\d\d/.test(err.message));
          if (!retryable || attempt >= maxRetries) throw err;
          const backoff = err.retryAfterMs ?? Math.min(20000, 2000 * 2 ** attempt);
          if (deadline !== undefined && now() + backoff > deadline) throw err; // no time left to wait
          nextSlot = Math.max(nextSlot, now() + backoff);
        }
      }
    };
    const result = chain.then(run, run); // calls queue up behind each other
    chain = result.catch(() => undefined);
    return result;
  };
  return generate;
}

export function geminiFromEnv(overrides: Partial<GeminiOptions> = {}): TextGenerator | null {
  return createGemini({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || undefined, rpm: Number(process.env.GEMINI_RPM) || undefined, ...overrides });
}
