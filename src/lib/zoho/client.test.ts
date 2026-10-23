import { describe, expect, it } from "vitest";
import { buildDraftPurchaseOrder, createZohoClient, exchangeGrantCode, zohoFromEnv, ZohoError, type ZohoConfig } from "./client";

const cfg: ZohoConfig = { dc: "in", clientId: "cid", clientSecret: "secret", refreshToken: "refresh", orgId: "999", vendorId: "v1", autoCreateItems: false };
type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };

function fake(responses: { status?: number; json: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body as string | undefined });
    const r = responses.shift() ?? { json: {} };
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const TOKEN = { json: { access_token: "AT", expires_in: 3600 } };
const client = (f: ReturnType<typeof fake>) => createZohoClient(cfg, { fetchImpl: f.fetchImpl, sleep: async () => {}, minGapMs: 0 });

describe("configuration", () => {
  const env = { ZOHO_DC: "in", ZOHO_CLIENT_ID: "a", ZOHO_CLIENT_SECRET: "b", ZOHO_REFRESH_TOKEN: "c", ZOHO_ORG_ID: "d", ZOHO_VENDOR_ID: "e" };
  it("is on only when every value is present", () => expect(zohoFromEnv(env)).toMatchObject({ dc: "in", orgId: "d", autoCreateItems: false }));
  it("stays off (mock mode) when anything is missing or the data centre is unknown", () => {
    for (const k of Object.keys(env)) expect(zohoFromEnv({ ...env, [k]: "" })).toBeNull();
    expect(zohoFromEnv({ ...env, ZOHO_DC: "mars" })).toBeNull();
    expect(zohoFromEnv({})).toBeNull();
  });
  it("creating missing items is opt-in", () => expect(zohoFromEnv({ ...env, ZOHO_AUTO_CREATE_ITEMS: "true" })!.autoCreateItems).toBe(true));
});

describe("the draft purchase order", () => {
  const po = buildDraftPurchaseOrder({ vendorId: "v1", date: "2026-10-23", reference: "FR-20261023", notes: "n", lines: [{ item_id: "i1", quantity: 120 }] });
  it("has the vendor, the lines and a reference", () => expect(po).toEqual({ vendor_id: "v1", date: "2026-10-23", reference_number: "FR-20261023", notes: "n", line_items: [{ item_id: "i1", quantity: 120 }] }));
  it("never sets a status, so Zoho creates it as a draft", () => expect(JSON.stringify(po)).not.toMatch(/status|issued|approved/i));
  it("keeps the reference within Zoho's length limit", () => expect(buildDraftPurchaseOrder({ vendorId: "v", date: "d", reference: "x".repeat(80), notes: "", lines: [] }).reference_number.length).toBe(50));
});

describe("the client", () => {
  it("signs in with the refresh token on the right data centre, and sends the token as a Zoho-oauthtoken header", async () => {
    const f = fake([TOKEN, { json: { code: 0, organizations: [{ organization_id: "999", name: "Demo Org" }] } }]);
    expect(await client(f).ping()).toEqual({ orgName: "Demo Org" });
    expect(f.calls[0].url).toBe("https://accounts.zoho.in/oauth/v2/token");
    expect(f.calls[0].body).toContain("grant_type=refresh_token");
    expect(f.calls[1].url).toBe("https://www.zohoapis.in/inventory/v1/organizations?organization_id=999");
    expect(f.calls[1].headers.authorization).toBe("Zoho-oauthtoken AT");
  });
  it("reuses the token within the hour", async () => {
    const f = fake([TOKEN, { json: { code: 0, items: [] } }, { json: { code: 0, items: [] } }]);
    const c = client(f);
    await c.getItemBySku("A"); await c.getItemBySku("B");
    expect(f.calls.filter((x) => x.url.includes("/oauth/")).length).toBe(1);
  });
  it("finds an item by SKU, or says there is none", async () => {
    expect(await client(fake([TOKEN, { json: { code: 0, items: [{ item_id: "i9", sku: "FR-013" }] } }])).getItemBySku("FR-013")).toBe("i9");
    expect(await client(fake([TOKEN, { json: { code: 0, items: [] } }])).getItemBySku("FR-013")).toBeNull();
  });
  it("creates a draft purchase order with a POST to /purchaseorders and nothing else", async () => {
    const f = fake([TOKEN, { json: { code: 0, purchaseorder: { purchaseorder_id: "p1", purchaseorder_number: "PO-00007", status: "draft" } } }]);
    const r = await client(f).createDraftPurchaseOrder(buildDraftPurchaseOrder({ vendorId: "v1", date: "2026-10-23", reference: "r", notes: "n", lines: [{ item_id: "i1", quantity: 5 }] }));
    expect(r).toEqual({ id: "p1", number: "PO-00007", status: "draft" });
    expect(f.calls[1].method).toBe("POST");
    expect(f.calls[1].url).toBe("https://www.zohoapis.in/inventory/v1/purchaseorders?organization_id=999");
    expect(f.calls.some((c) => /issued|approve|status|delete/i.test(c.url))).toBe(false);
  });
  it("turns Zoho's refusals into a readable error", async () => {
    const f = fake([TOKEN, { status: 400, json: { code: 1001, message: "Invalid value passed for vendor_id" } }]);
    await expect(client(f).createDraftPurchaseOrder(buildDraftPurchaseOrder({ vendorId: "bad", date: "d", reference: "r", notes: "n", lines: [] }))).rejects.toMatchObject({ message: "Invalid value passed for vendor_id", zohoCode: 1001 });
  });
  it("says so plainly when sign-in fails", async () => {
    await expect(client(fake([{ status: 400, json: { error: "invalid_code" } }])).ping()).rejects.toThrow(/refused the sign-in/);
  });
  it("exposes no way to issue or delete a purchase order", () => {
    const names = Object.keys(client(fake([])));
    expect(names.sort()).toEqual(["createDraftPurchaseOrder", "createItem", "getItemBySku", "ping"]);
  });
});

describe("exchanging the one-time code", () => {
  it("returns the refresh token", async () => {
    const f = fake([{ json: { refresh_token: "RT", access_token: "AT" } }]);
    expect(await exchangeGrantCode({ dc: "in", clientId: "c", clientSecret: "s", code: "abc" }, f.fetchImpl)).toBe("RT");
    expect(f.calls[0].url).toBe("https://accounts.zoho.in/oauth/v2/token");
  });
  it("explains an expired code", async () => {
    await expect(exchangeGrantCode({ dc: "in", clientId: "c", clientSecret: "s", code: "old" }, fake([{ json: { error: "invalid_code" } }]).fetchImpl)).rejects.toBeInstanceOf(ZohoError);
  });
});
