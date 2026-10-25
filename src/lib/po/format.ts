// A purchase order here is a DOCUMENT: one day's approved orders, laid out for procurement. It is derived from the orders
// Raghav approved or edited that day, so it needs no workflow and places nothing. Pure functions, no database.

export const poNumberForDate = (isoDate: string) => `FR-PO-${isoDate.replaceAll("-", "")}`;

/** Only a real calendar date names a purchase order. */
export function isPoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // rejects 2026-02-30 and 2026-13-01
}

export interface PoLine { sku_id: string; name: string; category: string; is_perishable: boolean; quantity: number; recommended_qty: number | null; status: string; flag_type: string; urgent: boolean; decision_tag: string | null; weeks_of_stock: number | null }

export interface PoSummary { lines: number; units: number; edited: number; byCategory: { category: string; lines: number; units: number }[] }

export function summarize(lines: Pick<PoLine, "category" | "quantity" | "status">[]): PoSummary {
  const cat = new Map<string, { lines: number; units: number }>();
  for (const l of lines) {
    const c = cat.get(l.category) ?? { lines: 0, units: 0 };
    c.lines++; c.units += l.quantity;
    cat.set(l.category, c);
  }
  return {
    lines: lines.length,
    units: lines.reduce((a, l) => a + l.quantity, 0),
    edited: lines.filter((l) => l.status === "edited").length,
    byCategory: [...cat].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.units - a.units || a.category.localeCompare(b.category)),
  };
}

/** Says what Raghav changed on a line, so procurement sees it. Nothing when he approved it as recommended. */
export function changeNote(l: Pick<PoLine, "quantity" | "recommended_qty" | "status">): string | null {
  if (l.status !== "edited" || l.recommended_qty === null || l.recommended_qty === l.quantity) return null;
  const d = l.quantity - l.recommended_qty;
  return `Quantity changed by Raghav from ${l.recommended_qty.toLocaleString("en-IN")} (${d > 0 ? "+" : "-"}${Math.abs(d).toLocaleString("en-IN")})`;
}
