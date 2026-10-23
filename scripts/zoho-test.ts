// Checks the Zoho connection from your computer: signs in and reads the organisation name. Changes nothing.   npm run zoho:test
import { createZohoClient, zohoFromEnv } from "../src/lib/zoho/client";

async function main() {
  const cfg = zohoFromEnv();
  if (!cfg) throw new Error("Zoho is not fully configured in .env.local (ZOHO_DC, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID, ZOHO_VENDOR_ID).");
  const { orgName } = await createZohoClient(cfg).ping();
  console.log(`Connected to Zoho Inventory (${cfg.dc}). Organisation: ${orgName}. Draft purchase orders go to vendor ${cfg.vendorId}.`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
