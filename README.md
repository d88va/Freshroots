# Freshroots Demand Planning

A twice-weekly reorder assistant for Freshroots, a 200-person FMCG distributor in Maharashtra and Goa.

Raghav Kulkarni, the Senior Demand Planner, used to spend two days a month pulling SAP data and building a reorder forecast for 400 SKUs. By the time procurement saw it, the data was 3 to 4 weeks old, and stockouts and overstock cost ₹28 to 34 lakh a quarter.

This system applies Raghav's documented rules to every SKU every Monday and Thursday morning, flags what needs action, and puts the flags in front of him. **He approves, edits or overrides each one. Procurement only orders what he approved.** The system also learns from his decisions and shows him where the rules may need to change. **He decides.**

> **Read this first: what is real and what is not.**
> - There is **no live SAP connection**. SAP data comes from CSV files.
> - **Zoho has two modes.** By default it is a **mock**: approved orders are listed on the Orders page, can be downloaded as a CSV, and are marked "sent to Zoho (mock)". Nothing is sent anywhere. If you add the `ZOHO_` settings (see "Connecting Zoho"), a **Send to Zoho** button creates **one draft purchase order** in Zoho Inventory from the orders Raghav approved. The system never issues it: procurement reviews and places it in Zoho.
> - The demo data is **synthetic**: 400 invented SKUs, 3 years of invented sales, and invented past decisions. It proves the machinery works. It does not prove Raghav's rules work at Freshroots. That needs real exports (see "Swapping in real data").
> - The app has **no login**, by decision. Anyone with the URL can use it. Keep the URL private.

---

## The three boundaries (and where they are enforced)

| Boundary | What it means | Where it lives |
|---|---|---|
| **1. The Cut** | Every number and every flag is computed in plain code. The AI never calculates, never changes a flag, never removes one. It only writes a one-line reason for a flag whose numbers are already computed. | `src/lib/rules/engine.ts` (pure functions, no database, no AI). `src/lib/reasons/` (the AI is only handed finished numbers). |
| **2. Human gate: orders** | The system never places an order. Nothing reaches the Orders page, or Zoho, unless Raghav approved or edited it. "Needs judgment" flags can never be bulk-approved. Zoho only ever receives a **draft** purchase order. | `src/lib/review/decide.ts`, enforced again by the server in `src/app/api/flags/`. The Zoho client (`src/lib/zoho/client.ts`) has no function that issues, approves or deletes a purchase order. |
| **3. Human gate: rules** | The system never edits its own rules, thresholds or season factors. Feedback produces suggestions only. A rule changes only when Raghav accepts or edits a suggestion, or edits it on the Settings page. That saves a new rule version, used from the next run. | `src/lib/rules/settings.ts` (the only code that writes a rule), `src/lib/feedback/resolve.ts`. |

**How the AI is kept inside the cut.** Gemini Flash is shown one flag at a time, as plain-English facts the rules already computed. Its sentence is then checked in code. It is thrown away, and a template written by code is used instead, if it contains any number that was not in the input (including numbers written as words), is more than one sentence, uses markdown, claims an order was placed, or contradicts the flag. If Gemini is down, slow, out of quota or has no key, every flag simply gets the template reason. The system works the same. Every flag records who wrote its reason (`reason_source`: ai or template) and why a template was used (`reason_fallback`). Every attempt, including rejected ones, is logged in `reason_attempts`.

---

## What the system does, in order

1. **Import** (Upload page): SAP-style and Zoho-style CSV files are checked column by column. Bad rows are rejected with a clear message.
2. **Run** (Monday and Thursday 07:00 IST, or the Run now button): the rules engine looks at every SKU and raises flags. Each flag carries every number behind it.
3. **Reasons**: each flag gets a template reason straight away, then Gemini upgrades as many as the daily allowance allows, most urgent first.
4. **Review** (Raghav): approve, edit the quantity, or override with a one-tap reason tag. Needs-judgment flags are in their own section, decided one at a time.
5. **Orders**: only approved or edited flags. CSV download. In mock mode "sent to Zoho (mock)"; when Zoho is connected, a **Send to Zoho** button creates a draft purchase order.
6. **Feedback**: a daily job (07:30 IST) checks decisions that are 28 or more days old. A Feedback page summarises them. When a rule is overridden often, or a reason keeps coming back, a suggestion card appears.
7. **Rules**: Raghav accepts, edits or dismisses a suggestion, or edits the rules directly on Settings. Each save is a new, versioned rule. Every run records which version it used.
8. **Kill criteria** (Metrics page): four stop signals that only ever show status.

### The pages

| Page | What it is for |
|---|---|
| Review | Pending flags by urgency. Approve, edit, override. Thumbs on the AI reason. "Approve all" (with a confirm dialog) never includes needs-judgment flags. |
| Orders | Two tabs. **Approved orders**: the last 14 days ("show all" for the rest). CSV. Mock Zoho, or **Send to Zoho as a draft** when connected. Paused orders listed separately. **Purchase orders**: one invoice-style document per approval day (`/orders/po/<date>`), printable as a PDF, with a per-PO CSV. Derived from approved orders; no prices or suppliers are invented. |
| Runs | Run history, Run now, next scheduled run, why running twice never doubles a flag. |
| Season calendar | Active season factors, a learned monthly demand index per category beside the factor, suggestion cards for sharp gaps, and an event log (festivals, own schemes, competitor schemes). Display only. |
| Feedback | Outcome checks, monthly summary by rule, tag and category, suggestions with accept, edit, dismiss, and the rule version history. |
| Override log | Every override with its tag, note and the rating of the AI reason. |
| Backtest | Replays the rules over 3 years of history (kill criterion K2), with a chance baseline and flag load so the headline cannot mislead. |
| Metrics | The kill criteria panel, and the brief's baseline next to what the system measures. |
| Settings | Edit rules (versioned), project dates, kill thresholds, and the **Pause system** switch. |
| Upload data | CSV import. |

---

## Raghav's rules (the defaults)

All thresholds live in the database and are editable on Settings. Nothing is hard-coded.

| Rule | Default | Result |
|---|---|---|
| **High demand** | Last 4 weeks' average sales more than **20%** above the 12-week average | Flag `high_demand`, recommend **1.5x** the standard order quantity |
| **Stockout risk** | Stock below **6 weeks** of average weekly sales | Flag `stockout_risk`, recommend an immediate reorder (default: the standard order quantity) |
| **Overstock risk** | Stock above **14 weeks** of average weekly sales | Flag `overstock_risk`, recommend pausing the next order |
| **Season factor** | October, November, March: multiply the 12-week average by **1.25** before any threshold check. Every other month is flat. | A setting switches between "uplift the 12-week baseline" (default) and "uplift the weeks-of-stock check only". **This is an open question for Raghav.** |
| **Perishables** | **3 weeks** minimum and **4 weeks** maximum, **instead of** the 6 and 14 week limits | Below 3: stockout risk. Above 4: overstock risk. The high-demand rule still applies. Replacing, not stacking, is essential: 4 weeks is already below 6, so stacking would flag every perishable. |
| **Needs judgment** | Fewer than **12 weeks** of history (new launch), missing or gappy data, or the 4-week average more than **2x** or less than **0.5x** the 12-week average | Flag `needs_judgment`. **No quantity is ever recommended.** These thresholds are my proposals, to confirm with Raghav. |

**Order of evaluation:** season factor, then needs-judgment check, then perishable or standard windows, then high demand. A SKU that is both high demand and stockout risk becomes one flag, marked **urgent**, recommending 1.5x. Where high demand and overstock both apply, the rules point in opposite directions, so both flags are kept, no quantity is recommended, and Raghav decides.

**A rule that is not in Raghav's five:** after Raghav decides a SKU, it is not flagged again for **7 days** (`reflag_cooldown_days`, 0 turns it off). Without it, the stock has not arrived yet, so the next run would flag the same SKU again and invite a double order. Confirm this with Raghav.

**Simplification to state plainly:** rules run at **SKU level, company-wide**, not per distributor. The brief's data is per distributor across 1,200 distributors. **Distributor-level logic is the natural next step.**

---

## The kill switch

Four stop signals from the pre-build map. **They only show status. The system never stops, pauses or changes anything by itself.** Stopping the build is the owner's decision. Every threshold is a setting.

| | What it measures | Stop line | Green / amber / red |
|---|---|---|---|
| **K1** Day 30, Import page | The SAP export is automated and clean by day 30 (counted from the `project_start_date` setting). Three checks: the owner has confirmed a scheduled export, the latest imports had no rejected rows, the newest sales week is at most 14 days old. | Any check failing on day 30 | Green: all pass. Amber: not yet, days left. Red: day 30 reached with a check failing. |
| **K2** Backtest | The share of past stockouts and write-offs the rules would have flagged before they happened. | Under **50%** | Red below 50, amber 50 to 60, green above. Shown with a chance baseline. |
| **K3** Week 6 live, Review screen | The share of decided flags Raghav overrides, counted only from 6 weeks after go-live. | More than **30%** | Red above 30, amber above 20, green below. Grey until 6 weeks after go-live. |
| **K4** Two quarters | Stockout and write-off rupees against the same dates a year earlier (so festival months are fairly compared). | No better than the baseline | Red: no better. Amber: better but under the 25% target. Green: at or above 25%. Grey ("not yet measurable") until two quarters of data exist. |

**Pause switch** (Settings): a toggle that blocks the Monday and Thursday run, the Run now button and the outcome check, shows a red "System paused" banner on every page, and keeps existing flags visible. Pausing and resuming each need a typed reason and are logged. When K3 turns red, a banner on every page suggests a pause. It never pauses by itself.

---

## Setting it up from scratch

You need three free accounts. Nothing else is installed on your computer except Node.

**1. Neon (the database).** neon.com, sign up, Create project, pick a region near you. On the dashboard click **Connect**, turn **Connection pooling** ON, and copy the string that starts with `postgresql://`. That is `DATABASE_URL`.

**2. Gemini (the reason writer, optional).** aistudio.google.com/apikey, Create API key (choose "in new project"). That is `GEMINI_API_KEY`. The free tier allows about 20 requests a day, so on a busy day some reasons stay as templates until the next day. The system works without it.

**3. Vercel (hosting and the schedule).** vercel.com, sign up with GitHub, Add New, Project, import this repository, leave the settings alone, and add the environment variables below before pressing Deploy.

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon string |
| `GEMINI_API_KEY` | the Gemini key (optional) |
| `CRON_SECRET` | any long random string (at least 16 characters). Vercel then sends it automatically on every scheduled call. |

Never put these in code or in the repository. `.env.local` is git-ignored. `.env.local.example` lists the names.

**On your computer:**

```bash
npm install
cp .env.local.example .env.local      # then fill it in
npm run db:migrate                     # creates all tables (13 migration files, safe to run twice)
npm run seed:load -- --reset           # loads the synthetic data
npm run seed:history -- --reset        # loads the demo decision history
npm run feedback:check                 # builds outcomes and suggestions
npm run dev                            # http://localhost:3000
npm test                               # 184 tests
```

### All commands

| Command | What it does |
|---|---|
| `npm run db:migrate` | Applies the SQL files in `neon/migrations/`, once each |
| `npm run seed:generate` / `seed:check` / `seed:load` | Make, check and load the synthetic data (`-- --reset` empties first) |
| `npm run seed:history` | Demo decision history with backdated dates (`-- --reset`, `-- --dry`) |
| `npm run run:now` | The same code as Run now and the schedule |
| `npm run rules:dry` | Shows how many SKUs land in each flag type, and checks the planted demo cases |
| `npm run backtest` | Replays the rules over history |
| `npm run reasons:demo` / `reasons:fill` | Try the AI reasons / fill pending ones |
| `npm run feedback:check` | The outcome check and suggestions, as the daily job does |
| `npm run zoho:token -- --code <code>` | Turns the one-time code from the Zoho API Console into a refresh token, saved to `.env.local` (never printed) |
| `npm run zoho:test` | Checks the Zoho connection (signs in, reads the organisation name, changes nothing) |
| `npm run zoho:selftest` | Safety check of the send logic against the real database with a fake Zoho. It proves an order is never sent twice, and an overridden or old order is never sent |
| `npm run demo:reset -- --yes` | Puts the demo back to a clean starting state (**read the warning in the file first**) |

### The schedule

`vercel.json` holds two jobs: the rules run at `30 1 * * 1,4` (07:00 IST every Monday and Thursday, because Vercel Cron runs in UTC) and the outcome check at `0 2 * * *` (07:30 IST daily). Both calls need the `CRON_SECRET`. On Vercel's free Hobby plan, scheduled jobs may fire anywhere within the scheduled hour, so "07:00" can be up to an hour late.

---

## Connecting Zoho

Without any setup the app runs in mock mode. To send approved orders to Zoho Inventory as **draft purchase orders**:

1. **Account.** Sign up for Zoho Inventory (a free trial is enough for a demo) at the data centre for your region (India is `in`). Create an organisation and one vendor (Purchases, Vendors, New) for the drafts to be made out to.
2. **Three ids.** The **organisation id** is in Settings, Organization Profile. The **vendor id** is the number in the vendor's page address. The **data centre** is the ending of your Zoho address (`in` for zoho.in).
3. **API credentials.** Open the Zoho API Console for your data centre (api-console.zoho.in for India), Add Client, choose **Self Client**, and copy the **client id and secret**. On the Generate Code tab use the scope `ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.READ,ZohoInventory.items.CREATE,ZohoInventory.items.READ,ZohoInventory.contacts.READ,ZohoInventory.settings.READ` and a 10-minute duration, and copy the code.
4. **Refresh token.** Put `ZOHO_DC`, `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` in `.env.local`, then run `npm run zoho:token -- --code <the code>` within a few minutes. The code works once.
5. **The rest.** Add `ZOHO_ORG_ID` and `ZOHO_VENDOR_ID`. For a trial, also `ZOHO_AUTO_CREATE_ITEMS=true`, which creates a Zoho item for any SKU that is missing. Leave it off for a real Zoho, where the items already exist and a missing one is reported, not invented.
6. **Check.** `npm run zoho:test` should print the organisation name. On Vercel, add the same `ZOHO_` variables and redeploy, then press **Test connection** on the Settings page.

**What a send does.** On the Orders page, **Send N to Zoho as a draft** opens a confirm dialog. Confirming creates **one draft purchase order** with a line per order, matching each SKU to a Zoho item by its SKU. It is a draft: nothing is issued. An order is sent at most once (a database claim, safe even if two people click at the same moment), only orders approved or edited in the last 14 days are eligible, at most 50 lines go in one send, and sending is blocked while the system is paused. An order that cannot be sent, for example because its item is missing in Zoho, is marked failed and retried on the next send.

**Not done, on purpose.** There is no code that issues, approves or deletes a purchase order. Reading open purchase orders and standard quantities from Zoho is not built: those still come from the CSV import.

---

## Swapping in real SAP and Zoho exports

The Upload page already reads real exports. **No code changes are needed.** It matches column names loosely (ignoring case, spaces and punctuation), so `Material`, `material_number` and `SKU` all work as the SKU id.

| Upload as | Source | Columns (any of the usual SAP or Zoho names) |
|---|---|---|
| SKU master and standard order quantity | SAP / Zoho | sku id, name, category, perishable (yes/no), standard order quantity, launch date (optional) |
| Weekly sales | SAP | sku id, date, units. **Any level of detail:** distributor rows, daily rows or weekly rows are all summed into one row per SKU per Monday-week. |
| Stock on hand | SAP | sku id, date, units on hand. Several warehouses for the same SKU and date are added up. |
| Open purchase orders | Zoho | sku id, quantity, expected date. Context only: never used in a calculation. Each upload replaces the previous snapshot. |
| Past losses | SAP | sku id, date, type (stockout or write_off), value in rupees. Used by the backtest and the outcome check. |
| Calendar events | Freshroots | kind, name, start date, end date, note |

Dates may be `2026-10-19`, `19/10/2026`, `19.10.2026`, SAP's `20261019`, or an ISO week such as `2026-W42`. **Load the SKU master first.** Rows for an unknown SKU are skipped and reported. Loading a file twice is safe: existing rows are updated.

**To start with real data instead of the demo** (do this only on a database that holds nothing you want to keep):

1. In the Neon SQL Editor run `truncate skus, calendar_events, runs, suggestions, outcomes cascade;`.
2. On Settings: empty the **run date override**, and set the real **project start date**. Leave **go-live** empty until Raghav starts using it. Set "scheduled SAP export confirmed" to **No** until IT has really scheduled one.
3. Upload the files on the Upload page, in the order above.
4. Press Run now, then run the backtest on the Backtest page. That K2 number, on real history, is the one that counts.

---

## Changing a rule

1. **Settings page.** Change a threshold, type why, save. It becomes a new rule version, used from the next run. The version history shows what changed, when and why.
2. **From a suggestion.** On the Feedback page, accept the proposed change, or edit it to your own value, and type your reason. The change and the suggestion's resolution are saved together or not at all.

Either way, the new value is validated first (for example the stockout limit must stay below the overstock limit). The system has no way to change a rule on its own: the only code that writes one is `saveRuleChange`, and the only things that call it are those two actions.

---

## How the feedback loop works

- **Capture:** on every approve, edit or override Raghav can tap one reason tag (season missed, new launch, competitor scheme, data wrong, other). An override requires a tag, and free text if "other". He can rate each AI reason with a thumb.
- **Outcome check:** for decisions 28 or more days old. **Approved or edited flags:** it records only where the stock ended up (back in the healthy band, still too low, still too high). It never says the flag was right or wrong, because the order itself changed the outcome. **Overridden flags:** it records whether the feared stockout or write-off happened anyway within 4 weeks. If not, Raghav was right. If it did, he was wrong. **Misses:** losses on a SKU with no flag in the 4 weeks before.
- **Suggestions:** when one rule is overridden 10 or more times in a month, or the same tag recurs 10 or more times, a card appears with the evidence. Where the evidence points to a specific change, the card shows what that change would have done to past decisions: how many overridden flags it would have stopped, and how many flags Raghav kept it would also have stopped, so a weak trade-off is visible.

---

## Honest limits

- **Synthetic data.** The headline numbers (the backtest, the override rates, the outcomes) describe the demo data. In particular, "Raghav was right" on most checked overrides because the invented loss history rarely produces a stockout after an override. Real data will differ.
- **The backtest headline is generous.** The rules flag about a third of SKUs on an average run, so almost any loss has an earlier flag nearby. That is why the Backtest page also shows a chance baseline (random SKUs would score about 81.5%, the rules 94.8%) and the flag load. Read the headline next to those.
- **Gemini free tier.** About 20 reasons a day. The rest stay as templates, and nothing breaks.
- **No login.** Run now, Approve and Settings are open to anyone with the URL. The run lock and the daily Gemini cap limit the damage. The data is synthetic.
- **Run date override.** The demo data stops in October 2026. A setting makes the app pretend it is 22 October 2026, so the rules keep working on any later day. Empty it for real use.
- **Raghav's time** (the brief's "2 days a month") is not measured by the system. Ask him monthly.
- **Event effects** on the Season calendar are measured on total sales, so a scheme that hit two categories barely shows. A category field on events would fix that.

---

## Decisions that differ from, or add to, the brief

- No password anywhere (your decision). Resuming from a pause needs a typed reason instead of a password.
- Season calendar is a table of dated events, with the season months and uplift as settings.
- The feedback tag column is named `decision_tag`, because it applies to approve and edit too.
- Added: the Zoho draft purchase order connection (opt-in), the 7-day hold-back after a decision, the chance baseline and flag load on the backtest, an import log, a per-key daily Gemini allowance, and the run date override.
- Upgraded to Next.js 16 and React 19, because every earlier version has known security advisories.

## Project layout

```
src/lib/rules/      the rules engine (pure functions) and rule saving
src/lib/reasons/    facts, template reasons, the number check, the Gemini client
src/lib/review/     what Raghav may do with a flag (the order gate)
src/lib/run/        runs, the schedule, the pause switch
src/lib/feedback/   outcome check, suggestions, accept/edit/dismiss
src/lib/kill/       the four kill criteria and project settings
src/lib/season/     learned monthly index, events
src/lib/backtest/   the replay
src/app/            pages and API routes
neon/migrations/    plain SQL, 13 files
scripts/            seed, run, reset, demo helpers
data/seed/          the synthetic CSV files
```
