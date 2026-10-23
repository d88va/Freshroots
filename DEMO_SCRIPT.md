# The 4-minute demo

**The story in one sentence:** the system does the data work twice a week and puts flags in front of Raghav, but he decides every order and every rule, and the AI only writes one line of explanation.

## Before you start (5 minutes earlier, do this once)

```bash
npm run demo:reset            # shows what it will remove. Read it.
npm run demo:reset -- --yes   # puts the demo in a clean starting state
```

This clears earlier click-throughs, restores the documented default rules, un-pauses the system, runs the rules, and re-opens the feedback suggestions. It writes AI reasons for the most urgent flags first, up to Gemini's free daily allowance, so **run it on the morning of the demo**, not the night before.

Open these tabs in this order: **Runs, Review, Orders, Feedback, Settings, Metrics**. Check there is no "System paused" banner.

If a reason says "Template" instead of "AI-written", that is the safety net working, not a fault. Say so.

---

## The script

| Time | Page | What you do | What you say |
|---|---|---|---|
| **0:00** | **Runs** | Point at "Next scheduled run: Monday 7:00 am IST". Press **Run now** and read the result line. | "Every Monday and Thursday at 7 the system reads the latest data and applies Raghav's five documented rules to all 400 SKUs. I'll run it now. It flags about 45 SKUs that need action, 7 of them it can't judge. It says 0 new: the same 45 are already waiting, and pressing it again changes nothing. The database refuses a second pending flag for the same SKU." |
| **0:30** | **Review**, top row | Click the arrow on the first row (**FR-013 Classic Banana Chips 400g**, URGENT) to expand it. Point at the cover meter, then the numbers and the reason. | "This is a stockout flag, and it's urgent because demand is also surging. Stock covers 2 weeks against a 6-week minimum, and recent sales are far above their usual level, so the rule recommends 1.5 times the standard order. Every number here was calculated in code. The AI only wrote this sentence, and if it ever invents a figure the system throws it away and uses a template." |
| **1:00** | **Review**, find **FR-343 Soft Sandwich Bread 250g** (scroll, it is a perishable stockout) | Point at "2.9 weeks · min 3" and its meter. Don't decide it. | "Bread goes off, so it uses a tighter window: 3 weeks minimum and 4 maximum, **instead of** the 6 and 14. If the two rules stacked, every perishable would be flagged as a stockout. Another bread, FR-347 at 5.8 weeks, would be a stockout under the normal rule, but it's an overstock here." |
| **1:30** | **Review**, **Needs your judgment** tab | Show **FR-310 Masala Noodles 70g**: "New launch, only 8 weeks of sales history". Point out there is no Approve button. Then go back to **To review**, open the **Approve all** dialog at the top right, read it, and **Cancel**. | "New launches, data gaps and sudden swings are the 15 to 20% Raghav handles on judgment. The system recommends no quantity, and these can never be bulk-approved. The Approve-all dialog says so: it excludes them, and the server enforces it even if someone bypasses the screen." |
| **2:00** | **Review**, top row | Expand the first row and click **Override** with no tag: it refuses. Tap **Competitor scheme**, then **Override**. Then approve the next urgent row (**FR-016**) with its **Approve** button. | "An override always needs a reason, one tap. That's the raw material for learning. He disagreed here because a competitor scheme is dragging demand." |
| **2:30** | **Orders** | Show the approved order and the "sent to Zoho (mock)" banner. Click **Download CSV**. | "Only what Raghav approved reaches this list. If Zoho is connected, one click creates a draft purchase order there: a draft, never issued, so procurement still places it. Otherwise it is a CSV standing in for the import. Nothing is placed by the system." |
| **2:50** | **Feedback** | Open the card **"Perishable window (minimum stock), August"**. Read the evidence. Click **Accept this change…**, type a reason ("Festival demand starts early"), save. Then open **Settings** and show the new rule version. Back on **Runs**, press **Run now** and point at the "Rules" column. | "In August he overrode the perishable minimum 20 times, mostly tagged 'season missed'. The system suggests lowering it from 3 to 2.5 weeks, and shows the trade-off: it would also have stopped flags he kept. It never changes anything itself. He accepts with a reason, that becomes a new rule version, and the next run uses it: the bread at 2.9 weeks is no longer flagged, and the run says so. The run history records which version it used." |
| **3:30** | **Metrics** | Point at the four rows: K1 green, K2 green, K3 amber, K4 "not yet measurable". | "These are the stop signals from the plan. K2 says the rules would have caught 95% of past losses. I'd quote that with care: random flagging would have scored 81%, so the real gain is smaller. K3 is amber: he is overriding about a fifth of flags, and the pause line is 30%. The panel only shows status. Stopping is the owner's call." |
| **3:45** | **Settings** | Type a reason, click **Pause system**. Show the red banner. Go to **Runs**, press **Run now**: it is blocked. Back on Settings, resume with a reason. | "And the owner has one switch. Paused, nothing runs and every page says so, but existing flags stay visible. Both actions are logged with a reason." |

---

## After the demo

Put the rules back where you found them, so the next run is repeatable:

- **Settings > Rules:** set **Perishables: minimum weeks of stock** back to **3**, with the reason "Restored after demo". Or simply run `npm run demo:reset -- --yes` again.

---

## Questions to expect

**Why is the AI not doing the calculation?** Because Raghav's rules are documented and checkable, and an AI that calculates can be wrong silently. Code gives the same answer every time, and can be tested (184 automated tests). The AI only writes one sentence from numbers already computed, and that sentence is checked.

**What if Gemini is wrong or down?** Any sentence with a number that wasn't in the input is rejected and replaced by a template written in code. If Gemini is down, over its limit or has no key, every flag uses the template. The system behaves the same.

**Is 95% a good result?** It is encouraging but not proof. It's on synthetic data, and the rules flag about a third of SKUs, which makes catching things easy. That's why the Backtest page shows a chance baseline (81%). The real K2 number comes from real SAP history.

**Why does it hold a SKU back for 7 days after a decision?** Once an order is approved the stock hasn't arrived yet, so without the hold-back the next run would flag the same SKU again and invite a double order. It's a setting, and it isn't one of Raghav's five rules, so it needs his confirmation.

**Can the system change a rule on its own?** No. The only code that writes a rule is called by two buttons Raghav presses: accept or edit on a suggestion, and save on Settings. Every change needs a reason and creates a new version.

**Why no login?** A decision for this build. The data is synthetic and the URL is private. Adding sign-in is straightforward, but it wasn't asked for.

**Is it connected to SAP and Zoho?** SAP: no, CSV files stand in, and a real export can be dropped on the Upload page with no code change. Zoho: by default a mock. When connected, it only creates a draft purchase order from orders Raghav approved. It can't issue one, and an order is never sent twice.
