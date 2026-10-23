// Zoho Inventory client. It can do exactly four things: get a short-lived access token, look an item up by SKU,
// create an item (only when allowed), and create a DRAFT purchase order. There is deliberately no function that
// issues, approves, sends or deletes a purchase order: procurement does that in Zoho. Secrets come from the environment.

export type DataCentre = "com" | "in" | "eu" | "au" | "jp";

const HOSTS: Record<DataCentre, { accounts: string; api: string }> = {
  com: { accounts: "https://accounts.zoho.com", api: "https://www.zohoapis.com" },
  in: { accounts: "https://accounts.zoho.in", api: "https://www.zohoapis.in" },
  eu: { accounts: "https://accounts.zoho.eu", api: "https://www.zohoapis.eu" },
  au: { accounts: "https://accounts.zoho.com.au", api: "https://www.zohoapis.com.au" },
  jp: { accounts: "https://accounts.zoho.jp", api: "https://www.zohoapis.jp" },
};

export interface ZohoConfig {
  dc: DataCentre; clientId: string; clientSecret: string; refreshToken: string; orgId: string; vendorId: string; autoCreateItems: boolean;
}

export class ZohoError extends Error {
  constructor(message: string, public status?: number, public zohoCode?: number) { super(message); }
}

/** Reads the connection from the environment. Returns null unless every required value is present: the app then stays in mock mode. */
export function zohoFromEnv(env: Record<string, string | undefined> = process.env): ZohoConfig | null {
  const dc = (env.ZOHO_DC ?? "").toLowerCase() as DataCentre;
  const { ZOHO_CLIENT_ID: clientId, ZOHO_CLIENT_SECRET: clientSecret, ZOHO_REFRESH_TOKEN: refreshToken, ZOHO_ORG_ID: orgId, ZOHO_VENDOR_ID: vendorId } = env;
  if (!(dc in HOSTS) || !clientId || !clientSecret || !refreshToken || !orgId || !vendorId) return null;
  return { dc, clientId, clientSecret, refreshToken, orgId, vendorId, autoCreateItems: env.ZOHO_AUTO_CREATE_ITEMS === "true" };
}

export interface PurchaseOrderLine { item_id: string; quantity: number }
export interface DraftPurchaseOrder { vendor_id: string; date: string; reference_number: string; notes: string; line_items: PurchaseOrderLine[] }

/** The body of a draft purchase order. No status is sent, so Zoho creates it as a draft. */
export function buildDraftPurchaseOrder(o: { vendorId: string; date: string; reference: string; notes: string; lines: PurchaseOrderLine[] }): DraftPurchaseOrder {
  return { vendor_id: o.vendorId, date: o.date, reference_number: o.reference.slice(0, 50), notes: o.notes.slice(0, 2000), line_items: o.lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })) };
}

export interface ZohoOptions { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; minGapMs?: number }

export function createZohoClient(cfg: ZohoConfig, o: ZohoOptions = {}) {
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const host = HOSTS[cfg.dc];
  const gap = o.minGapMs ?? 700; // Zoho allows about 100 calls a minute per organisation: stay well inside that
  let token: { value: string; expires: number } | null = null;
  let last = 0;

  async function accessToken(): Promise<string> {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const body = new URLSearchParams({ refresh_token: cfg.refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token" });
    const res = await f(`${host.accounts}/oauth/v2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString(), signal: AbortSignal.timeout(15000) });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !j.access_token) throw new ZohoError(`Zoho refused the sign-in${j.error ? `: ${j.error}` : ""}. The refresh token may be wrong, expired or for another data centre.`, res.status);
    token = { value: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function call<T>(method: "GET" | "POST", path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const wait = last + gap - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const q = new URLSearchParams({ organization_id: cfg.orgId, ...(opts.query ?? {}) });
    const res = await f(`${host.api}/inventory/v1${path}?${q}`, {
      method,
      headers: { authorization: `Zoho-oauthtoken ${await accessToken()}`, ...(opts.body ? { "content-type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const j = (await res.json().catch(() => ({}))) as { code?: number; message?: string } & T;
    if (!res.ok || (typeof j.code === "number" && j.code !== 0)) throw new ZohoError(j.message ?? `Zoho returned ${res.status}`, res.status, j.code);
    return j;
  }

  return {
    /** The organisation's name, to prove the connection works. */
    async ping(): Promise<{ orgName: string }> {
      const j = await call<{ organizations?: { organization_id: string; name: string }[] }>("GET", "/organizations");
      const org = j.organizations?.find((x) => x.organization_id === cfg.orgId);
      if (!org) throw new ZohoError(`Signed in, but organisation ${cfg.orgId} was not found for this account.`);
      return { orgName: org.name };
    },
    async getItemBySku(sku: string): Promise<string | null> {
      const j = await call<{ items?: { item_id: string; sku?: string }[] }>("GET", "/items", { query: { sku } });
      return j.items?.find((i) => i.sku === sku)?.item_id ?? j.items?.[0]?.item_id ?? null;
    },
    async createItem(i: { name: string; sku: string }): Promise<string> {
      const j = await call<{ item?: { item_id: string } }>("POST", "/items", { body: { name: i.name, sku: i.sku, item_type: "inventory", product_type: "goods" } });
      if (!j.item?.item_id) throw new ZohoError("Zoho did not return the new item.");
      return j.item.item_id;
    },
    /** Creates a DRAFT purchase order. It is not issued: procurement reviews and places it in Zoho. */
    async createDraftPurchaseOrder(po: DraftPurchaseOrder): Promise<{ id: string; number: string; status: string }> {
      const j = await call<{ purchaseorder?: { purchaseorder_id: string; purchaseorder_number: string; status: string } }>("POST", "/purchaseorders", { body: po });
      if (!j.purchaseorder) throw new ZohoError("Zoho did not return the purchase order.");
      return { id: j.purchaseorder.purchaseorder_id, number: j.purchaseorder.purchaseorder_number, status: j.purchaseorder.status };
    },
  };
}

export type ZohoClient = ReturnType<typeof createZohoClient>;

/** Turns a one-time grant code from the Zoho API Console into a refresh token. Used once, by `npm run zoho:token`. */
export async function exchangeGrantCode(o: { dc: DataCentre; clientId: string; clientSecret: string; code: string }, f: typeof fetch = fetch): Promise<string> {
  const body = new URLSearchParams({ grant_type: "authorization_code", client_id: o.clientId, client_secret: o.clientSecret, code: o.code });
  const res = await f(`${HOSTS[o.dc].accounts}/oauth/v2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  const j = (await res.json().catch(() => ({}))) as { refresh_token?: string; error?: string };
  if (!j.refresh_token) throw new ZohoError(`Zoho did not give a refresh token${j.error ? `: ${j.error}` : ""}. The code lasts only a few minutes and works once: generate a new one.`, res.status);
  return j.refresh_token;
}
