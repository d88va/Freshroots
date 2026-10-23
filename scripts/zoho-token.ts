// Turns the one-time code from the Zoho API Console into a refresh token and saves it in .env.local. The token is never printed.
//   npm run zoho:token -- --code 1000.xxxx      (needs ZOHO_DC, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET in .env.local)
import fs from "node:fs";
import { exchangeGrantCode, type DataCentre } from "../src/lib/zoho/client";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const code = arg("code");
  const { ZOHO_DC, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET } = process.env;
  if (!code) throw new Error("Pass the code: npm run zoho:token -- --code <the code from the API Console>");
  if (!ZOHO_DC || !ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) throw new Error("ZOHO_DC, ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be in .env.local first.");
  const refresh = await exchangeGrantCode({ dc: ZOHO_DC as DataCentre, clientId: ZOHO_CLIENT_ID, clientSecret: ZOHO_CLIENT_SECRET, code });
  let env = fs.readFileSync(".env.local", "utf8");
  env = /^ZOHO_REFRESH_TOKEN=.*$/m.test(env) ? env.replace(/^ZOHO_REFRESH_TOKEN=.*$/m, `ZOHO_REFRESH_TOKEN=${refresh}`) : env.replace(/\n?$/, `\nZOHO_REFRESH_TOKEN=${refresh}\n`);
  fs.writeFileSync(".env.local", env);
  console.log(`Saved ZOHO_REFRESH_TOKEN to .env.local (${refresh.length} characters, not shown).`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
