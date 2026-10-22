// Asks Gemini for reasons on pending flags that still have a template waiting for the AI.   npm run reasons:fill
import { getSql } from "../src/lib/db/client";
import { fillReasons } from "../src/lib/reasons/apply";
import { geminiFromEnv } from "../src/lib/reasons/gemini";

fillReasons(getSql(), { gen: geminiFromEnv(), budgetMs: 150000, model: process.env.GEMINI_MODEL || "gemini-3.5-flash" })
  .then((s) => console.log(s))
  .catch((e) => { console.error(e.message); process.exit(1); });
