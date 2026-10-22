// Synthetic data for the demo. Same seed in, same files out, every time.
//
//   npm run seed:generate
//
// Two parts:
//  1. HISTORY: 400 SKUs x 156 weeks of demand with seasonality, festival months and random shocks.
//     A simulated planner orders once a month from a 3-week-old forecast, with occasional supplier
//     delays. Stockouts and write-offs are what that process really produces, so loss_events are
//     not made up row by row.
//  2. PLANTED CASES: the last 12 weeks are then shaped so every rule fires in the demo.
//
// "Today" for the demo is Monday 19 Oct 2026 (a festival month, so the 25% uplift is active).
// The planted stock levels are set for that date. Running the demo on another date still works,
// but the planted flags will shift.

import fs from "node:fs";
import path from "node:path";

// ---------- calendar ----------
const N_WEEKS = 156;
const LAST_WEEK = "2026-10-12"; // last complete week (Mon 12 Oct to Sun 18 Oct)
const TODAY = "2026-10-19"; // the Monday the demo "runs"
const FESTIVAL_MONTHS: Record<number, number> = { 10: 1.2, 11: 1.35, 3: 1.25 }; // real demand lift in the data

const addDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const FIRST_WEEK = addDays(LAST_WEEK, -7 * (N_WEEKS - 1));
const weekDate = (w: number) => addDays(FIRST_WEEK, 7 * w);
const weeks = Array.from({ length: N_WEEKS }, (_, w) => weekDate(w));
const monthOf = (iso: string) => Number(iso.slice(5, 7));
const dayOf = (iso: string) => Number(iso.slice(8, 10));
const quarterKey = (iso: string) => `${iso.slice(0, 4)}-Q${Math.ceil(monthOf(iso) / 3)}`;
const weekOfYear = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.floor((d.getTime() - start.getTime()) / (7 * 86400000));
};

// ---------- seeded random numbers ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261019);
const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const lognormal = (median: number, sigma: number) => median * Math.exp(sigma * normal());
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- the 400 SKUs ----------
interface Category { name: string; perishable: boolean; count: number; median: number; price: number; amp: number; peak: number; products: string[]; variants: string[]; sizes: string[] }
const CATEGORIES: Category[] = [
  { name: "Namkeen & Snacks", perishable: false, count: 80, median: 380, price: 35, amp: 0.08, peak: 44, products: ["Bhujia", "Peanuts", "Chivda", "Banana Chips", "Farsan Mix", "Khakhra", "Mathri", "Sev"], variants: ["Classic", "Masala", "Spicy", "Salted", "Jumbo", "Tangy"], sizes: ["150g", "200g", "400g"] },
  { name: "Biscuits & Cookies", perishable: false, count: 60, median: 420, price: 28, amp: 0.06, peak: 48, products: ["Glucose Biscuits", "Marie", "Cream Biscuits", "Cookies", "Rusk", "Digestive"], variants: ["Classic", "Choco", "Elaichi", "Family Pack", "Mini"], sizes: ["100g", "250g", "500g"] },
  { name: "Atta, Rice & Dal", perishable: false, count: 60, median: 520, price: 85, amp: 0.04, peak: 10, products: ["Whole Wheat Atta", "Basmati Rice", "Toor Dal", "Moong Dal", "Chana Dal", "Poha", "Sooji"], variants: ["Premium", "Everyday", "Select"], sizes: ["1kg", "5kg", "10kg"] },
  { name: "Edible Oils", perishable: false, count: 30, median: 300, price: 150, amp: 0.05, peak: 30, products: ["Sunflower Oil", "Groundnut Oil", "Mustard Oil", "Rice Bran Oil"], variants: ["Refined", "Cold Pressed", "Pure"], sizes: ["500ml", "1L", "5L"] },
  { name: "Beverages", perishable: false, count: 40, median: 340, price: 40, amp: 0.2, peak: 20, products: ["Mango Drink", "Lemon Soda", "Cola", "Jeera Soda", "Iced Tea", "Energy Drink", "Coconut Water"], variants: ["Original", "Zero", "Fresh", "Party Pack"], sizes: ["250ml", "600ml", "1.25L"] },
  { name: "Spices & Masalas", perishable: false, count: 30, median: 260, price: 60, amp: 0.05, peak: 46, products: ["Garam Masala", "Turmeric", "Red Chilli", "Coriander Powder", "Pav Bhaji Masala", "Goda Masala"], variants: ["Classic", "Premium", "Kitchen King"], sizes: ["50g", "100g", "200g"] },
  { name: "Instant Foods", perishable: false, count: 40, median: 330, price: 30, amp: 0.07, peak: 2, products: ["Noodles", "Instant Upma", "Pasta", "Soup Mix", "Ready Khichdi", "Vermicelli"], variants: ["Masala", "Veg", "Tomato", "Family"], sizes: ["70g", "140g", "280g"] },
  { name: "Bakery & Breads", perishable: true, count: 25, median: 230, price: 32, amp: 0.06, peak: 0, products: ["Sandwich Bread", "Pav", "Brown Bread", "Fruit Bun", "Cake Slice", "Milk Rusk Loaf"], variants: ["Fresh", "Soft", "Daily"], sizes: ["250g", "400g", "6 pack"] },
  { name: "Dairy Snacks", perishable: true, count: 20, median: 200, price: 55, amp: 0.1, peak: 22, products: ["Paneer", "Flavoured Curd", "Lassi", "Shrikhand", "Chaas", "Cheese Slices"], variants: ["Fresh", "Classic", "Creamy"], sizes: ["200g", "500g", "1L"] },
  { name: "Fresh Chutneys & Dips", perishable: true, count: 15, median: 150, price: 45, amp: 0.08, peak: 18, products: ["Mint Chutney", "Tamarind Chutney", "Garlic Dip", "Hummus", "Green Chilli Thecha"], variants: ["Fresh", "House"], sizes: ["150g", "300g"] },
];

type Role =
  | "normal" | "high_demand" | "stockout_risk" | "overstock_risk" | "high_demand_stockout"
  | "p_stockout_edge" | "p_ok_low_edge" | "p_overstock_edge" | "p_ok_high_edge" | "p_replace_proof"
  | "p_high_demand" | "p_high_demand_stockout" | "p_deep_stockout" | "p_deep_overstock"
  | "new_launch" | "competitor_drop" | "p_competitor_drop" | "rebound" | "gap" | "p_gap";

interface Sku {
  idx: number; sku_id: string; name: string; category: Category; perishable: boolean;
  base: number; price: number; standard_order_qty: number; launch_date: string;
  role: Role; wos?: number; surge?: number; note?: string; shockFree: boolean;
}

const skus: Sku[] = [];
{
  let n = 1;
  for (const c of CATEGORIES) {
    for (let i = 0; i < c.count; i++) {
      const base = Math.max(40, Math.min(4000, lognormal(c.median, 0.8)));
      const name = `${pick(c.variants)} ${pick(c.products)} ${pick(c.sizes)}`;
      skus.push({
        idx: n - 1, sku_id: `FR-${String(n).padStart(3, "0")}`, name, category: c, perishable: c.perishable,
        base, price: lognormal(c.price, 0.35),
        standard_order_qty: Math.max(10, Math.round((base * 4) / 10) * 10), // about 4 weeks of typical sales
        launch_date: addDays("2018-01-01", Math.floor(between(0, 1800))),
        role: "normal", shockFree: false,
      });
      n++;
    }
  }
}

// ---------- plant the demo cases ----------
{
  const np = shuffle(skus.filter((s) => !s.perishable));
  const pe = shuffle(skus.filter((s) => s.perishable));
  const assign = (pool: Sku[], role: Role, count: number, make: (i: number) => Partial<Sku>) => {
    for (let i = 0; i < count; i++) {
      const s = pool.shift()!;
      Object.assign(s, { role, shockFree: true }, make(i));
    }
  };
  const normalWos = () => between(8.5, 12);
  // r = sales multiple over the last 4 weeks. 2.4-2.8x fires high_demand even after the 1.25 uplift.
  assign(np, "high_demand", 8, () => ({ surge: between(2.4, 2.8), wos: normalWos(), note: "Sales up sharply in last 4 weeks, stock healthy" }));
  const SO = [1.2, 1.8, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.4, 5.6];
  assign(np, "stockout_risk", 10, (i) => ({ wos: SO[i], note: `Stock covers ${SO[i]} weeks (limit 6)` }));
  const OS = [15, 16, 17, 18, 20, 22, 25, 30, 35, 40];
  assign(np, "overstock_risk", 10, (i) => ({ wos: OS[i], note: `Stock covers ${OS[i]} weeks (limit 14)` }));
  const HS = [2.0, 3.5, 4.5];
  assign(np, "high_demand_stockout", 3, (i) => ({ surge: between(2.4, 2.8), wos: HS[i], note: `High demand AND ${HS[i]} weeks of stock: urgent` }));
  assign(np, "competitor_drop", 2, () => ({ surge: 0.25, wos: normalWos(), note: "Sales fell to a quarter after a competitor scheme" }));
  assign(np, "rebound", 1, () => ({ wos: normalWos(), note: "Almost no sales for 8 weeks (supply gap), then back to normal" }));
  assign(np, "gap", 1, () => ({ wos: normalWos(), note: "Two weeks of sales missing in the last 12" }));
  assign(np, "new_launch", 1, () => ({ wos: 9, note: "Launched 8 weeks ago, only 8 weeks of history" }));
  assign(pe, "p_stockout_edge", 1, () => ({ wos: 2.9, note: "Perishable: 2.9 weeks, just under the 3-week minimum" }));
  assign(pe, "p_ok_low_edge", 1, () => ({ wos: 3.1, note: "Perishable: 3.1 weeks, just inside the window, no flag" }));
  assign(pe, "p_overstock_edge", 1, () => ({ wos: 4.1, note: "Perishable: 4.1 weeks, just over the 4-week maximum" }));
  assign(pe, "p_ok_high_edge", 1, () => ({ wos: 3.9, note: "Perishable: 3.9 weeks, just inside the window, no flag" }));
  assign(pe, "p_replace_proof", 1, () => ({ wos: 5.8, note: "Perishable at 5.8 weeks: standard rule would say stockout, perishable rule says overstock" }));
  assign(pe, "p_high_demand", 1, () => ({ surge: 2.5, wos: 3.4, note: "Perishable with high demand, stock inside the window" }));
  assign(pe, "p_high_demand_stockout", 1, () => ({ surge: 2.5, wos: 2.2, note: "Perishable with high demand AND 2.2 weeks: urgent" }));
  assign(pe, "p_deep_stockout", 1, () => ({ wos: 1.0, note: "Perishable with 1 week of stock" }));
  assign(pe, "p_deep_overstock", 1, () => ({ wos: 8, note: "Perishable with 8 weeks of stock (write-off risk)" }));
  assign(pe, "p_competitor_drop", 1, () => ({ surge: 0.25, wos: 3.5, note: "Perishable, sales fell to a quarter" }));
  assign(pe, "p_gap", 1, () => ({ wos: 3.5, note: "Perishable with two missing weeks of sales" }));

  // the new launch has a launch date 8 weeks before the demo date
  const nl = skus.find((s) => s.role === "new_launch")!;
  nl.launch_date = weeks[N_WEEKS - 8];
}

// ---------- demand history ----------
const PLANT_WINDOW = 12; // last 12 weeks are shaped for planted SKUs

function buildDemand(s: Sku): number[] {
  const growth = 0.05;
  const shock = new Array(N_WEEKS).fill(1);
  const noShockFrom = N_WEEKS - 16; // keep ordinary SKUs calm near today so only planted SKUs flag
  for (let year = 0; year < 3; year++) {
    const lo = year * 52, hi = Math.min(noShockFrom, lo + 52);
    if (rand() < 0.35 && hi - lo > 12) { // competitor scheme: a dip
      const start = lo + Math.floor(between(0, hi - lo - 8)), len = Math.floor(between(4, 7));
      for (let k = 0; k < len && start + k < noShockFrom; k++) shock[start + k] = between(0.45, 0.65);
    }
    if (rand() < 0.5 && hi - lo > 12) { // promotion or one-off bulk demand: a spike
      const start = lo + Math.floor(between(0, hi - lo - 8)), len = Math.floor(between(2, 5));
      for (let k = 0; k < len && start + k < noShockFrom; k++) shock[start + k] = between(1.5, 1.9);
    }
  }
  const out: number[] = [];
  for (let w = 0; w < N_WEEKS; w++) {
    const d = weeks[w];
    const season = 1 + s.category.amp * Math.sin((2 * Math.PI * (weekOfYear(d) - s.category.peak + 13)) / 52);
    const festival = FESTIVAL_MONTHS[monthOf(d)] ?? 1;
    const trend = 1 + (growth * w) / 52;
    const noise = Math.exp(0.1 * normal());
    out.push(s.base * trend * season * festival * noise * (s.shockFree && w >= noShockFrom ? 1 : shock[w]));
  }
  // planted shaping
  const lastFour = (f: (v: number) => number) => { for (let w = N_WEEKS - 4; w < N_WEEKS; w++) out[w] = f(out[w]); };
  if (s.surge !== undefined) lastFour((v) => v * s.surge!);
  if (s.role === "rebound") for (let w = N_WEEKS - PLANT_WINDOW; w < N_WEEKS - 4; w++) out[w] *= 0.05;
  if (s.role === "new_launch") for (let k = 0; k < 8; k++) out[N_WEEKS - 8 + k] *= 0.5 + (0.5 * k) / 7;
  return out;
}

// ---------- the simulated planner: sales, stock and losses ----------
const PERISHABLE_SHELF_WEEKS = 5;
interface Sim { sales: number[]; snaps: number[]; stockouts: { w: number; units: number }[]; writeOffs: { w: number; units: number }[] }

function simulate(s: Sku, demand: number[]): Sim {
  const sales = new Array(N_WEEKS).fill(0);
  const snaps = new Array(N_WEEKS).fill(0);
  const stockouts: Sim["stockouts"] = [];
  const writeOffs: Sim["writeOffs"] = [];
  // Weeks of forecast the planner orders up to. Set so a planner who follows the 6-14 week (3-4 for perishables)
  // bands from the brief keeps stock inside them most of the time; losses then come from shocks, delays and festival ramps.
  const cover = s.perishable ? between(5.4, 6.2) : between(11.5, 13.5);
  const planted = s.role !== "normal";
  let stock = Math.round(demand[0] * (s.perishable ? 3.5 : 9));
  let batches: { qty: number; age: number }[] = s.perishable ? [{ qty: stock, age: 0 }] : [];
  const pipeline: { arr: number; qty: number }[] = [];

  const mean = (arr: number[], from: number, to: number) => {
    let sum = 0, cnt = 0;
    for (let i = Math.max(0, from); i <= to; i++) if (i < arr.length && i >= 0) { sum += arr[i]; cnt++; }
    return cnt ? sum / cnt : 0;
  };

  for (let w = 0; w < N_WEEKS; w++) {
    // 1. deliveries arrive
    for (let i = pipeline.length - 1; i >= 0; i--) {
      if (pipeline[i].arr <= w) {
        stock += pipeline[i].qty;
        if (s.perishable) batches.push({ qty: pipeline[i].qty, age: 0 });
        pipeline.splice(i, 1);
      }
    }
    // 2. place an order: monthly for ordinary SKUs (first Monday of the month), weekly for perishables
    const orderWeek = s.perishable || dayOf(weeks[w]) <= 7;
    if (orderWeek && w >= 1) {
      const history = w >= 8 ? sales : demand;
      const f = s.perishable ? mean(history, w - 5, w - 2) : mean(history, w - 7, w - 4); // forecast data is 2-3 weeks old
      const position = stock + pipeline.reduce((a, p) => a + p.qty, 0);
      const q = Math.round(Math.max(0, cover * f - position) / 10) * 10;
      if (q > 0) {
        const delayed = rand() < (s.perishable ? 0.08 : 0.2);
        const lead = 1 + (delayed ? (s.perishable ? 1 : 3 + Math.floor(rand() * 4)) : 0);
        pipeline.push({ arr: w + lead, qty: q });
      }
    }
    // 3. the week's demand meets the stock
    const d = Math.round(demand[w]);
    const shaped = planted && w >= N_WEEKS - PLANT_WINDOW; // planted weeks: never censor the shaped sales
    const sold = shaped ? d : Math.min(d, stock);
    sales[w] = sold;
    const unmet = d - sold;
    if (!shaped && unmet >= 10 && unmet >= 0.05 * d) stockouts.push({ w, units: unmet });
    stock = Math.max(0, stock - sold);
    if (s.perishable) {
      let need = sold;
      for (const b of batches) { const take = Math.min(b.qty, need); b.qty -= take; need -= take; } // oldest first
      batches = batches.filter((b) => b.qty > 0);
      for (const b of batches) b.age++;
      const expired = batches.filter((b) => b.age >= PERISHABLE_SHELF_WEEKS);
      const lost = expired.reduce((a, b) => a + b.qty, 0);
      if (lost > 0) {
        stock -= lost;
        batches = batches.filter((b) => b.age < PERISHABLE_SHELF_WEEKS);
        if (!shaped) writeOffs.push({ w, units: lost });
      }
    }
    snaps[w] = Math.max(0, stock);
  }
  return { sales, snaps, stockouts, writeOffs };
}

// ---------- run everything ----------
interface SalesRow { sku_id: string; week_start: string; units: number }
const salesRows: SalesRow[] = [];
const stockRows: { sku_id: string; snapshot_date: string; units_on_hand: number }[] = [];
const rawLoss: { sku_id: string; week_start: string; type: "stockout" | "write_off"; raw: number }[] = [];
const planted: { sku_id: string; name: string; category: string; perishable: boolean; role: Role; expected: string; weeks_of_stock_vs_uplifted_demand: string; note: string }[] = [];

const EXPECTED: Record<Role, string> = {
  normal: "none (background)",
  high_demand: "high_demand",
  stockout_risk: "stockout_risk",
  overstock_risk: "overstock_risk",
  high_demand_stockout: "high_demand + stockout_risk, urgent",
  p_stockout_edge: "stockout_risk (perishable rule)",
  p_ok_low_edge: "no flag (perishable rule)",
  p_overstock_edge: "overstock_risk (perishable rule)",
  p_ok_high_edge: "no flag (perishable rule)",
  p_replace_proof: "overstock_risk (perishable rule replaces standard rule)",
  p_high_demand: "high_demand",
  p_high_demand_stockout: "high_demand + stockout_risk, urgent",
  p_deep_stockout: "stockout_risk (perishable rule)",
  p_deep_overstock: "overstock_risk (perishable rule)",
  new_launch: "needs_judgment (under 12 weeks of history)",
  competitor_drop: "needs_judgment (4-week average under half the 12-week)",
  p_competitor_drop: "needs_judgment (4-week average under half the 12-week)",
  rebound: "needs_judgment (4-week average over 2x the 12-week)",
  gap: "needs_judgment (missing weeks)",
  p_gap: "needs_judgment (missing weeks)",
};

for (const s of skus) {
  const demand = buildDemand(s);
  const sim = simulate(s, demand);
  const isNew = s.role === "new_launch";
  const firstWeek = isNew ? N_WEEKS - 8 : 0;

  const gapWeeks = new Set<number>(s.role === "gap" || s.role === "p_gap" ? [N_WEEKS - 7, N_WEEKS - 6] : []);
  for (let w = firstWeek; w < N_WEEKS; w++) {
    if (gapWeeks.has(w)) continue;
    salesRows.push({ sku_id: s.sku_id, week_start: weeks[w], units: sim.sales[w] });
  }

  // current stock: designed for every SKU, so ordinary SKUs sit comfortably inside their windows
  const recent = [];
  for (let w = N_WEEKS - 12; w < N_WEEKS; w++) if (w >= firstWeek && !gapWeeks.has(w)) recent.push(sim.sales[w]);
  const avg12 = recent.reduce((a, b) => a + b, 0) / recent.length;
  const uplifted = 1.25 * avg12; // October is a festival month
  const wos = s.wos ?? (s.perishable ? between(3.3, 3.8) : between(8.5, 12));
  const currentStock = Math.max(0, Math.round(wos * uplifted));
  for (let w = firstWeek; w < N_WEEKS; w++) {
    const units = w === N_WEEKS - 1 ? currentStock : sim.snaps[w];
    stockRows.push({ sku_id: s.sku_id, snapshot_date: addDays(weeks[w], 7), units_on_hand: units });
  }

  // losses: consecutive stockout weeks are one incident, dated at its first week
  const price = s.price;
  const so = sim.stockouts.sort((a, b) => a.w - b.w);
  for (let i = 0; i < so.length; ) {
    let j = i, units = so[i].units;
    while (j + 1 < so.length && so[j + 1].w === so[j].w + 1) { j++; units += so[j].units; }
    rawLoss.push({ sku_id: s.sku_id, week_start: weeks[so[i].w], type: "stockout", raw: units * price });
    i = j + 1;
  }
  for (const wo of sim.writeOffs) rawLoss.push({ sku_id: s.sku_id, week_start: weeks[wo.w], type: "write_off", raw: wo.units * price * 0.6 });

  if (s.role !== "normal") {
    planted.push({
      sku_id: s.sku_id, name: s.name, category: s.category.name, perishable: s.perishable, role: s.role,
      expected: EXPECTED[s.role], weeks_of_stock_vs_uplifted_demand: wos.toFixed(2), note: s.note ?? "",
    });
  }
}

// Rescale the loss values quarter by quarter so the totals match the brief
// (stockouts Rs 18-22 lakh, write-offs Rs 10-12 lakh per quarter; partial quarters pro rata).
const LAKH = 100000;
const weeksInQuarter = new Map<string, number>();
for (const w of weeks) weeksInQuarter.set(quarterKey(w), (weeksInQuarter.get(quarterKey(w)) ?? 0) + 1);
const targets = new Map<string, number>();
for (const [q, n] of weeksInQuarter) {
  targets.set(`${q}|stockout`, between(18, 22) * LAKH * Math.min(1, n / 13));
  targets.set(`${q}|write_off`, between(10, 12) * LAKH * Math.min(1, n / 13));
}
const rawTotals = new Map<string, number>();
for (const e of rawLoss) {
  const key = `${quarterKey(e.week_start)}|${e.type}`;
  rawTotals.set(key, (rawTotals.get(key) ?? 0) + e.raw);
}
// Partial quarters (fewer than 10 weeks) are not rescaled to a target; they get the typical factor.
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const factorFor = (key: string) => (weeksInQuarter.get(key.split("|")[0])! >= 10 ? targets.get(key)! / rawTotals.get(key)! : NaN);
const typical = median([...rawTotals.keys()].map(factorFor).filter((f) => !Number.isNaN(f)));
const lossRows = rawLoss.map((e) => {
  const key = `${quarterKey(e.week_start)}|${e.type}`;
  const factor = Number.isNaN(factorFor(key)) ? typical : factorFor(key);
  return { sku_id: e.sku_id, week_start: e.week_start, type: e.type, value_inr: Math.round(e.raw * factor * 100) / 100 };
});
const factors = [...rawTotals.keys()].map(factorFor).filter((f) => !Number.isNaN(f));
console.log(`Loss rescale factors per quarter and type: min ${Math.min(...factors).toFixed(2)}, max ${Math.max(...factors).toFixed(2)} (1.00 means the simulation matched the brief unaided)`);

// open purchase orders: context only
const poRows: { sku_id: string; qty: number; expected_date: string }[] = [];
for (const s of skus) {
  const wantsPo = s.role === "stockout_risk" || s.role === "high_demand_stockout" ? rand() < 0.5 : rand() < 0.3;
  if (wantsPo) poRows.push({ sku_id: s.sku_id, qty: s.standard_order_qty * (1 + Math.floor(rand() * 2)), expected_date: addDays(TODAY, 3 + Math.floor(rand() * 25)) });
}

// ---------- write files ----------
const OUT = path.join(process.cwd(), "data", "seed");
fs.mkdirSync(OUT, { recursive: true });
const pad2 = (n: number) => String(n).padStart(2, "0");
const esc = (v: unknown) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const write = (file: string, header: string[], rows: Record<string, unknown>[]) => {
  fs.writeFileSync(path.join(OUT, file), [header.join(","), ...rows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n") + "\n");
  console.log(`  ${file}: ${rows.length} rows`);
};
console.log("Writing data/seed:");
// Dated events. Festival dates move every year, which is why they are rows and not just months.
// Festival dates are approximate calendar dates for the demo. The competitor scheme is planted:
// it lines up with the sales drop on the two competitor_drop SKUs and the perishable one.
const E = (kind: string, name: string, start_date: string, end_date: string, note: string, logged_by = "raghav") => ({ kind, name, start_date, end_date, note, logged_by });
const eventRows = [
  E("festival", "Diwali 2023", "2023-11-06", "2023-11-14", "Peak trade week before Diwali", "system"),
  E("festival", "Holi 2024", "2024-03-18", "2024-03-25", "", "system"),
  E("festival", "Ganesh Chaturthi 2024", "2024-09-02", "2024-09-17", "Big in Maharashtra and Goa", "system"),
  E("festival", "Diwali 2024", "2024-10-28", "2024-11-03", "", "system"),
  E("festival", "Holi 2025", "2025-03-10", "2025-03-14", "", "system"),
  E("festival", "Ganesh Chaturthi 2025", "2025-08-22", "2025-09-06", "", "system"),
  E("festival", "Diwali 2025", "2025-10-16", "2025-10-23", "", "system"),
  E("festival", "Holi 2026", "2026-03-01", "2026-03-04", "", "system"),
  E("festival", "Ganesh Chaturthi 2026", "2026-09-10", "2026-09-25", "", "system"),
  E("festival", "Diwali 2026", "2026-11-02", "2026-11-09", "Falls in November this year", "system"),
  E("own_scheme", "Freshroots Diwali trade scheme", "2026-10-05", "2026-10-31", "Extra margin for distributors on namkeen and biscuits"),
  E("competitor_scheme", "Competitor biscuit and namkeen scheme (Pune, Nashik)", "2026-09-21", "2026-10-18", "Distributors cut orders for about 4 weeks; planted to match the sales drop on FR-004, FR-156 and FR-372"),
  E("other", "Pune road works disrupted deliveries", "2025-07-14", "2025-07-27", "Some stockouts that fortnight were supply, not demand"),
];
write("calendar_events.csv", ["kind", "name", "start_date", "end_date", "note", "logged_by"], eventRows);
write("skus.csv", ["sku_id", "name", "category", "is_perishable", "standard_order_qty", "launch_date"],
  skus.map((s) => ({ sku_id: s.sku_id, name: s.name, category: s.category.name, is_perishable: s.perishable, standard_order_qty: s.standard_order_qty, launch_date: s.launch_date })));
write("weekly_sales.csv", ["sku_id", "week_start", "units"], salesRows as unknown as Record<string, unknown>[]);
write("stock_snapshots.csv", ["sku_id", "snapshot_date", "units_on_hand"], stockRows);
write("open_pos.csv", ["sku_id", "qty", "expected_date"], poRows);
write("loss_events.csv", ["sku_id", "week_start", "type", "value_inr"], lossRows);
write("planted_cases.csv", ["sku_id", "name", "category", "perishable", "role", "expected", "weeks_of_stock_vs_uplifted_demand", "note"], planted);
console.log(`Weeks: ${weeks[0]} to ${LAST_WEEK}. Demo run date: ${TODAY}.`);
