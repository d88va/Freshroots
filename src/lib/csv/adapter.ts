// CSV adapter: turns SAP-style and Zoho-style exports into the rows our tables expect.
// Pure functions, no database. The same code serves the seed loader and the Upload page,
// so a real export can replace the synthetic files without any code change.

import Papa from "papaparse";

export type FileKind = "skus" | "sales" | "stock" | "open_pos" | "loss_events" | "calendar_events";

export interface SkuRow {
  sku_id: string;
  name: string;
  category: string;
  is_perishable: boolean;
  standard_order_qty: number;
  launch_date: string | null;
}
export interface SalesRow { sku_id: string; week_start: string; units: number }
export interface StockRow { sku_id: string; snapshot_date: string; units_on_hand: number }
export interface OpenPoRow { sku_id: string; qty: number; expected_date: string }
export interface CalendarEventRow {
  kind: "festival" | "own_scheme" | "competitor_scheme" | "other";
  name: string;
  start_date: string;
  end_date: string;
  note: string | null;
  logged_by: string;
}
export interface LossRow {
  sku_id: string;
  week_start: string;
  type: "stockout" | "write_off";
  value_inr: number;
}

export interface ParseResult<T> {
  rows: T[];
  rowsRead: number;
  errors: { line: number; message: string }[]; // row skipped
  warnings: string[]; // row kept, but worth knowing
}

// ---------- column names ----------
// We compare headers after lower-casing and removing everything except letters and digits,
// so "Posting Date", "posting_date" and "POSTING-DATE" are the same column.
const ALIASES: Record<string, string[]> = {
  sku_id: ["skuid", "sku", "skucode", "material", "materialnumber", "materialno", "itemcode", "itemid"],
  name: ["name", "skuname", "description", "materialdescription", "itemname"],
  category: ["category", "materialgroup", "productcategory", "group"],
  is_perishable: ["isperishable", "perishable", "perishability", "highperishability"],
  standard_order_qty: ["standardorderqty", "standardorderquantity", "stdorderqty", "moq", "orderqty"],
  launch_date: ["launchdate", "launchedon", "introduced"],
  date: ["weekstart", "week", "date", "postingdate", "billingdate", "invoicedate", "documentdate", "snapshotdate", "stockdate", "asofdate"],
  units: ["units", "qty", "quantity", "salesqty", "unitssold", "billedqty"],
  units_on_hand: ["unitsonhand", "onhand", "stock", "stockqty", "unrestrictedstock", "closingstock", "quantityonhand"],
  qty: ["qty", "quantity", "orderedqty", "openqty", "quantityordered"],
  expected_date: ["expecteddate", "expecteddeliverydate", "deliverydate", "expectedarrival", "duedate"],
  type: ["type", "losstype", "eventtype"],
  event_kind: ["kind", "eventkind", "eventtype"],
  event_name: ["name", "eventname", "event"],
  start_date: ["startdate", "start", "from"],
  end_date: ["enddate", "end", "to", "until"],
  note: ["note", "notes", "comment"],
  logged_by: ["loggedby", "by", "owner"],
  value_inr: ["valueinr", "value", "lossvalue", "amountinr", "amount"],
};

const REQUIRED: Record<FileKind, string[]> = {
  skus: ["sku_id", "name", "category", "is_perishable", "standard_order_qty"],
  sales: ["sku_id", "date", "units"],
  stock: ["sku_id", "date", "units_on_hand"],
  open_pos: ["sku_id", "qty", "expected_date"],
  loss_events: ["sku_id", "date", "type", "value_inr"],
  calendar_events: ["event_kind", "event_name", "start_date", "end_date"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Maps our canonical column name -> the actual header in the file. */
function mapHeaders(headers: string[], kind: FileKind): { map: Record<string, string>; missing: string[] } {
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const map: Record<string, string> = {};
  const wanted = new Set([...REQUIRED[kind], ...(kind === "skus" ? ["launch_date"] : []), ...(kind === "calendar_events" ? ["note", "logged_by"] : [])]);
  for (const canonical of wanted) {
    for (const alias of ALIASES[canonical]) {
      const found = byNorm.get(alias);
      if (found) { map[canonical] = found; break; }
    }
  }
  // A sales file may also say "week_start"; nothing special needed, it is an alias of "date".
  const missing = REQUIRED[kind].filter((c) => !map[c]);
  return { map, missing };
}

// ---------- value parsing ----------

const pad = (n: number) => String(n).padStart(2, "0");

/** Accepts 2026-10-19, 19/10/2026, 19-10-2026, 19.10.2026, SAP's 20261019 and ISO weeks (2026-W42). Day comes before month. */
export function parseDate(raw: string): string | null {
  const s = (raw ?? "").trim();
  const iso = s.match(/^(\d{4})-?W(\d{1,2})$/i); // ISO week such as 2026-W42: use that week's Monday
  if (iso) {
    const [y, w] = [+iso[1], +iso[2]];
    if (w < 1 || w > 53) return null;
    const jan4 = new Date(Date.UTC(y, 0, 4)); // 4 January is always in ISO week 1
    jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7);
    return jan4.toISOString().slice(0, 10);
  }
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +match[1]; m = +match[2]; d = +match[3]; }
  else if ((match = s.match(/^(\d{4})(\d{2})(\d{2})$/))) { y = +match[1]; m = +match[2]; d = +match[3]; }
  else if ((match = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/))) { d = +match[1]; m = +match[2]; y = +match[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Monday of the week containing the given ISO date (weeks run Monday to Sunday). */
export function weekStartOf(isoDate: string): string {
  const dt = new Date(isoDate + "T00:00:00Z");
  const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/** "1,200" and "1200.0" both become 1200. Returns null if not a number. */
export function parseNumber(raw: string): number | null {
  const s = (raw ?? "").toString().replace(/[,\s₹]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseBool(raw: string): boolean | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (["true", "yes", "y", "1", "high", "perishable"].includes(s)) return true;
  if (["false", "no", "n", "0", "low", "none", "non-perishable", ""].includes(s)) return false;
  return null;
}

// ---------- the parser ----------

function readCsv(text: string): { headers: string[]; records: Record<string, string>[] } {
  const clean = text.replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(clean, { header: true, skipEmptyLines: "greedy" });
  return { headers: parsed.meta.fields ?? [], records: parsed.data };
}

function fail<T>(message: string): ParseResult<T> {
  return { rows: [], rowsRead: 0, errors: [{ line: 1, message }], warnings: [] };
}

export function parseSkus(text: string): ParseResult<SkuRow> {
  const { headers, records } = readCsv(text);
  const { map, missing } = mapHeaders(headers, "skus");
  if (missing.length) return fail(`Missing column(s): ${missing.join(", ")}`);
  const out: ParseResult<SkuRow> = { rows: [], rowsRead: records.length, errors: [], warnings: [] };
  const seen = new Set<string>();
  records.forEach((r, i) => {
    const line = i + 2;
    const sku_id = (r[map.sku_id] ?? "").trim();
    const qty = parseNumber(r[map.standard_order_qty]);
    const perishable = parseBool(r[map.is_perishable]);
    if (!sku_id) return void out.errors.push({ line, message: "Empty SKU id" });
    if (seen.has(sku_id)) return void out.errors.push({ line, message: `Duplicate SKU ${sku_id}` });
    if (qty === null || qty <= 0) return void out.errors.push({ line, message: `${sku_id}: standard order quantity must be a positive number` });
    if (perishable === null) return void out.errors.push({ line, message: `${sku_id}: could not read perishable value "${r[map.is_perishable]}"` });
    let launch: string | null = null;
    if (map.launch_date && (r[map.launch_date] ?? "").trim() !== "") {
      launch = parseDate(r[map.launch_date]);
      if (!launch) return void out.errors.push({ line, message: `${sku_id}: bad launch date "${r[map.launch_date]}"` });
    }
    seen.add(sku_id);
    out.rows.push({
      sku_id,
      name: (r[map.name] ?? "").trim() || sku_id,
      category: (r[map.category] ?? "").trim() || "Uncategorised",
      is_perishable: perishable,
      standard_order_qty: Math.round(qty),
      launch_date: launch,
    });
  });
  return out;
}

/**
 * Sales: any level of detail. One row per distributor per day, per week, or already
 * summed per SKU: all of it is added up into one row per SKU per Monday-week.
 * Extra columns (distributor id and so on) are ignored.
 */
export function parseSales(text: string): ParseResult<SalesRow> {
  const { headers, records } = readCsv(text);
  const { map, missing } = mapHeaders(headers, "sales");
  if (missing.length) return fail(`Missing column(s): ${missing.join(", ")}`);
  const out: ParseResult<SalesRow> = { rows: [], rowsRead: records.length, errors: [], warnings: [] };
  const totals = new Map<string, number>();
  records.forEach((r, i) => {
    const line = i + 2;
    const sku_id = (r[map.sku_id] ?? "").trim();
    const date = parseDate(r[map.date]);
    const units = parseNumber(r[map.units]);
    if (!sku_id) return void out.errors.push({ line, message: "Empty SKU id" });
    if (!date) return void out.errors.push({ line, message: `${sku_id}: bad date "${r[map.date]}"` });
    if (units === null) return void out.errors.push({ line, message: `${sku_id}: units "${r[map.units]}" is not a number` });
    const key = `${sku_id}|${weekStartOf(date)}`;
    totals.set(key, (totals.get(key) ?? 0) + units);
  });
  let clamped = 0;
  for (const [key, total] of totals) {
    const [sku_id, week_start] = key.split("|");
    if (total < 0) clamped++;
    out.rows.push({ sku_id, week_start, units: Math.max(0, Math.round(total)) });
  }
  if (clamped) out.warnings.push(`${clamped} SKU-week(s) had negative totals (returns); stored as 0.`);
  return out;
}

/**
 * Stock: if the file has a location/warehouse column, counts for the same SKU and date are added
 * up across locations (stock is company-wide). Without one, the last count in the file wins.
 */
export function parseStock(text: string): ParseResult<StockRow> {
  const { headers, records } = readCsv(text);
  const { map, missing } = mapHeaders(headers, "stock");
  if (missing.length) return fail(`Missing column(s): ${missing.join(", ")}`);
  const out: ParseResult<StockRow> = { rows: [], rowsRead: records.length, errors: [], warnings: [] };
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const locationCol = ["location", "warehouse", "plant", "storagelocation", "site"].map((a) => byNorm.get(a)).find(Boolean);
  const latest = new Map<string, StockRow>();
  records.forEach((r, i) => {
    const line = i + 2;
    const sku_id = (r[map.sku_id] ?? "").trim();
    const date = parseDate(r[map.date]);
    const units = parseNumber(r[map.units_on_hand]);
    if (!sku_id) return void out.errors.push({ line, message: "Empty SKU id" });
    if (!date) return void out.errors.push({ line, message: `${sku_id}: bad date "${r[map.date]}"` });
    if (units === null || units < 0) return void out.errors.push({ line, message: `${sku_id}: stock "${r[map.units_on_hand]}" must be 0 or more` });
    const key = `${sku_id}|${date}`;
    const add = locationCol ? (latest.get(key)?.units_on_hand ?? 0) : 0;
    latest.set(key, { sku_id, snapshot_date: date, units_on_hand: add + Math.round(units) });
  });
  if (locationCol) out.warnings.push(`Counts were added up across "${locationCol}" so stock is company-wide.`);
  out.rows = [...latest.values()];
  return out;
}

export function parseOpenPos(text: string): ParseResult<OpenPoRow> {
  const { headers, records } = readCsv(text);
  const { map, missing } = mapHeaders(headers, "open_pos");
  if (missing.length) return fail(`Missing column(s): ${missing.join(", ")}`);
  const out: ParseResult<OpenPoRow> = { rows: [], rowsRead: records.length, errors: [], warnings: [] };
  records.forEach((r, i) => {
    const line = i + 2;
    const sku_id = (r[map.sku_id] ?? "").trim();
    const qty = parseNumber(r[map.qty]);
    const expected = parseDate(r[map.expected_date]);
    if (!sku_id) return void out.errors.push({ line, message: "Empty SKU id" });
    if (qty === null || qty <= 0) return void out.errors.push({ line, message: `${sku_id}: quantity must be a positive number` });
    if (!expected) return void out.errors.push({ line, message: `${sku_id}: bad expected date "${r[map.expected_date]}"` });
    out.rows.push({ sku_id, qty: Math.round(qty), expected_date: expected });
  });
  return out;
}

export function parseLossEvents(text: string): ParseResult<LossRow> {
  const { headers, records } = readCsv(text);
  const { map, missing } = mapHeaders(headers, "loss_events");
  if (missing.length) return fail(`Missing column(s): ${missing.join(", ")}`);
  const out: ParseResult<LossRow> = { rows: [], rowsRead: records.length, errors: [], warnings: [] };
  records.forEach((r, i) => {
    const line = i + 2;
    const sku_id = (r[map.sku_id] ?? "").trim();
    const date = parseDate(r[map.date]);
    const type = (r[map.type] ?? "").trim().toLowerCase().replace(/[\s-]/g, "_");
    const value = parseNumber(r[map.value_inr]);
    if (!sku_id) return void out.errors.push({ line, message: "Empty SKU id" });
    if (!date) return void out.errors.push({ line, message: `${sku_id}: bad date "${r[map.date]}"` });
    if (type !== "stockout" && type !== "write_off") return void out.errors.push({ line, message: `${sku_id}: type must be stockout or write_off, got "${r[map.type]}"` });
    if (value === null || value < 0) return void out.errors.push({ line, message: `${sku_id}: value must be 0 or more` });
    out.rows.push({ sku_id, week_start: weekStartOf(date), type, value_inr: Math.round(value * 100) / 100 });
  });
  return out;
}

/** Dated events: festivals, Freshroots schemes, competitor schemes, anything unusual. */
export function parseCalendarEvents(text: string): ParseResult<CalendarEventRow> {
  const { headers, records } = readCsv(text);
  const { map, missing } = mapHeaders(headers, "calendar_events");
  if (missing.length) return fail(`Missing column(s): ${missing.join(", ")}`);
  const out: ParseResult<CalendarEventRow> = { rows: [], rowsRead: records.length, errors: [], warnings: [] };
  const seen = new Set<string>();
  const KINDS = ["festival", "own_scheme", "competitor_scheme", "other"];
  records.forEach((r, i) => {
    const line = i + 2;
    const kind = (r[map.event_kind] ?? "").trim().toLowerCase().replace(/[\s-]/g, "_");
    const name = (r[map.event_name] ?? "").trim();
    const start = parseDate(r[map.start_date]);
    const end = parseDate(r[map.end_date]);
    if (!KINDS.includes(kind)) return void out.errors.push({ line, message: `Kind must be one of ${KINDS.join(", ")}, got "${r[map.event_kind]}"` });
    if (!name) return void out.errors.push({ line, message: "Event has no name" });
    if (!start || !end) return void out.errors.push({ line, message: `${name}: bad start or end date` });
    if (end < start) return void out.errors.push({ line, message: `${name}: ends before it starts` });
    const key = `${kind}|${name}|${start}`;
    if (seen.has(key)) return void out.errors.push({ line, message: `Duplicate event ${name} (${start})` });
    seen.add(key);
    out.rows.push({ kind: kind as CalendarEventRow["kind"], name, start_date: start, end_date: end, note: (map.note && r[map.note]?.trim()) || null, logged_by: (map.logged_by && r[map.logged_by]?.trim()) || "raghav" });
  });
  return out;
}

/** Guesses nothing: the caller says which kind of file it is. */
export function parseByKind(kind: FileKind, text: string) {
  switch (kind) {
    case "skus": return parseSkus(text);
    case "sales": return parseSales(text);
    case "stock": return parseStock(text);
    case "open_pos": return parseOpenPos(text);
    case "loss_events": return parseLossEvents(text);
    case "calendar_events": return parseCalendarEvents(text);
  }
}

export const FILE_KINDS: { kind: FileKind; label: string; source: string; columns: string }[] = [
  { kind: "calendar_events", label: "Calendar events (festivals, schemes)", source: "Freshroots", columns: "kind (festival, own_scheme, competitor_scheme, other), name, start_date, end_date, note (optional), logged_by (optional)" },
  { kind: "skus", label: "SKU master and standard order quantity", source: "SAP / Zoho", columns: "sku_id, name, category, is_perishable, standard_order_qty, launch_date (optional)" },
  { kind: "sales", label: "Weekly sales", source: "SAP", columns: "sku_id, date, units (any level of detail: distributor rows are summed)" },
  { kind: "stock", label: "Stock on hand", source: "SAP", columns: "sku_id, date, units_on_hand" },
  { kind: "open_pos", label: "Open purchase orders", source: "Zoho", columns: "sku_id, qty, expected_date" },
  { kind: "loss_events", label: "Past losses (for the backtest)", source: "SAP", columns: "sku_id, date, type (stockout or write_off), value_inr" },
];
