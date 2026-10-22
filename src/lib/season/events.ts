// Validation for the event log: Raghav's own schemes, competitor schemes, festivals, anything unusual.
// Events are context and learning material. They do not change any number or flag.

export const EVENT_KINDS = ["festival", "own_scheme", "competitor_scheme", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const KIND_LABELS: Record<EventKind, string> = { festival: "Festival", own_scheme: "Our scheme", competitor_scheme: "Competitor scheme", other: "Other" };

export interface EventInput { kind?: unknown; name?: unknown; start_date?: unknown; end_date?: unknown; note?: unknown }
export type EventResult = { ok: true; value: { kind: EventKind; name: string; start_date: string; end_date: string; note: string | null } } | { ok: false; error: string };

const isRealDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export function validateEvent(input: EventInput): EventResult {
  if (!(EVENT_KINDS as readonly unknown[]).includes(input.kind)) return { ok: false, error: "Pick what kind of event this is." };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "Give the event a name." };
  if (name.length > 120) return { ok: false, error: "The name is too long (120 characters at most)." };
  if (!isRealDate(input.start_date) || !isRealDate(input.end_date)) return { ok: false, error: "Start and end dates must be real dates." };
  if (input.end_date < input.start_date) return { ok: false, error: "The end date is before the start date." };
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 500) return { ok: false, error: "The note is too long (500 characters at most)." };
  return { ok: true, value: { kind: input.kind as EventKind, name, start_date: input.start_date, end_date: input.end_date, note: note || null } };
}
