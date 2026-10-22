// Small date helpers for the rules engine. Dates are ISO strings (2026-10-19), always treated as UTC.

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing the date (weeks run Monday to Sunday). */
export function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

export const monthOf = (iso: string) => Number(iso.slice(5, 7));
