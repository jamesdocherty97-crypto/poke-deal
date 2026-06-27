import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildAuthUrl, exchangeCodeForTokens, refreshAccessToken } from "./oauth.js";
import { buildInventoryItemPayload, upsertInventoryItem } from "./inventoryItem.js";
import { buildOfferPayload } from "./offer.js";
import { buildEbayOfferPreflight, toEbaySku } from "./preflight.js";
import { getAccessToken, clearTokenCache } from "./tokens.js";
import { fetchEbayPolicies } from "./policies.js";
import { isEbayConfigured, EBAY_UK_CATEGORY_POKEMON } from "./config.js";
import type { EbayConfig } from "./config.js";
import type { EbayPolicies } from "./policies.js";
import { buildListingPack } from "../dealer/listingPack.js";
import { checkEbayReadiness } from "./readiness.js";
import {
  buildInventoryLocationPayload,
  createInventoryLocation,
  missingEbayLocationSetupFields,
  readEbayLocationSetup,
  readEbayLocationSetupInput,
} from "./location.js";

const TEST_CONFIG: EbayConfig = {
  clientId: "TestClient-123",
  clientSecret: "test-secret",
  ruName: "TestApp-RuName-1234",
  env: "sandbox",
  marketplaceId: "EBAY_GB",
  contentLanguage: "en-GB",
  apiBaseUrl: "https://api.sandbox.ebay.com",
  authBaseUrl: "https://auth.sandbox.ebay.com",
  tokenUrl: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
};

const MOCK_POLICIES: EbayPolicies = {
  paymentPolicyId: "pay-001",
  fulfillmentPolicyId: "ship-001",
  returnPolicyId: "ret-001",
  merchantLocationKey: "uk-loc-1",
};

function mockFetch(
  status: number,
  body: unknown,
): typeof fetch {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response);
}

// ── not-configured mode ───────────────────────────────────────────────────────

test("isEbayConfigured returns false when credentials are missing", () => {
  // Remove env vars temporarily
  const saved = {
    id: process.env.EBAY_CLIENT_ID,
    secret: process.env.EBAY_CLIENT_SECRET,
    ru: process.env.EBAY_RU_NAME,
  };
  delete process.env.EBAY_CLIENT_ID;
  delete process.env.EBAY_CLIENT_SECRET;
  delete process.env.EBAY_RU_NAME;
  delete process.env.EBAY_REDIRECT_URI;

  assert.equal(isEbayConfigured(), false);

  // Restore
  if (saved.id) process.env.EBAY_CLIENT_ID = saved.id;
  if (saved.secret) process.env.EBAY_CLIENT_SECRET = saved.secret;
  if (saved.ru) process.env.EBAY_RU_NAME = saved.ru;
});

// ── OAuth URL builder ─────────────────────────────────────────────────────────

test("buildAuthUrl produces correct sandbox consent URL", () => {
  const url = buildAuthUrl(TEST_CONFIG);
  assert.match(url, /auth\.sandbox\.ebay\.com\/oauth2\/authorize/);
  assert.match(url, /client_id=TestClient-123/);
  assert.match(url, /redirect_uri=TestApp-RuName-1234/);
  assert.match(url, /response_type=code/);
  assert.match(url, /sell\.inventory/);
});

test("buildAuthUrl includes custom state", () => {
  const url = buildAuthUrl(TEST_CONFIG, "my-state-123");
  assert.match(url, /state=my-state-123/);
});

// ── Token exchange ────────────────────────────────────────────────────────────

test("exchangeCodeForTokens sends correct form body and returns tokens", async () => {
  const mockResponse = {
    access_token: "v^1.1-access-xyz",
    refresh_token: "v^1.1-refresh-abc",
    expires_in: 7200,
    token_type: "User Access Token",
  };

  let capturedBody = "";
  let capturedAuth = "";

  const fetch: typeof globalThis.fetch = (url, opts) => {
    capturedBody = String(opts?.body ?? "");
    capturedAuth = (opts?.headers as Record<string, string>)?.Authorization ?? "";
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    } as Response);
  };

  const result = await exchangeCodeForTokens(TEST_CONFIG, "auth-code-999", fetch);

  assert.equal(result.access_token, "v^1.1-access-xyz");
  assert.equal(result.refresh_token, "v^1.1-refresh-abc");
  assert.match(capturedBody, /grant_type=authorization_code/);
  assert.match(capturedBody, /code=auth-code-999/);
  assert.match(capturedBody, /redirect_uri=TestApp-RuName-1234/);
  assert.match(capturedAuth, /^Basic /);
});

test("exchangeCodeForTokens throws on non-ok response", async () => {
  const fetch = mockFetch(401, { error: "invalid_client" });
  await assert.rejects(
    () => exchangeCodeForTokens(TEST_CONFIG, "bad-code", fetch),
    /token exchange failed 401/,
  );
});

// ── Token refresh ─────────────────────────────────────────────────────────────

test("refreshAccessToken sends refresh_token grant and returns access token", async () => {
  const mockResponse = {
    access_token: "v^1.1-refreshed",
    expires_in: 7200,
    token_type: "User Access Token",
  };

  let capturedBody = "";
  const fetch: typeof globalThis.fetch = (_url, opts) => {
    capturedBody = String(opts?.body ?? "");
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    } as Response);
  };

  const result = await refreshAccessToken(TEST_CONFIG, "v^1.1-refresh-abc", fetch);

  assert.equal(result.access_token, "v^1.1-refreshed");
  assert.match(capturedBody, /grant_type=refresh_token/);
  assert.match(capturedBody, /refresh_token=v%5E1.1-refresh-abc/);
  assert.match(capturedBody, /scope=.*sell\.inventory/);
});

test("refreshAccessToken throws on failure", async () => {
  const fetch = mockFetch(400, { error: "invalid_grant" });
  await assert.rejects(
    () => refreshAccessToken(TEST_CONFIG, "expired-token", fetch),
    /token refresh failed 400/,
  );
});

// ── getAccessToken with cache ─────────────────────────────────────────────────

beforeEach(() => clearTokenCache());

test("getAccessToken uses EBAY_REFRESH_TOKEN to obtain access token", async () => {
  process.env.EBAY_REFRESH_TOKEN = "v^1.1-stored-refresh";
  let callCount = 0;
  const fetch: typeof globalThis.fetch = () => {
    callCount++;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ access_token: "v^1.1-fresh", expires_in: 7200 }),
    } as Response);
  };

  const token = await getAccessToken(TEST_CONFIG, fetch);
  assert.equal(token, "v^1.1-fresh");
  assert.equal(callCount, 1);

  // Second call should use cache
  const token2 = await getAccessToken(TEST_CONFIG, fetch);
  assert.equal(token2, "v^1.1-fresh");
  assert.equal(callCount, 1); // no new fetch

  delete process.env.EBAY_REFRESH_TOKEN;
});

test("getAccessToken throws when EBAY_REFRESH_TOKEN is missing", async () => {
  delete process.env.EBAY_REFRESH_TOKEN;
  await assert.rejects(
    () => getAccessToken(TEST_CONFIG),
    /EBAY_REFRESH_TOKEN is not set/,
  );
});

// ── Inventory item payload ────────────────────────────────────────────────────

const rawInput = {
  card: {
    name: "Umbreon VMAX",
    setName: "Evolving Skies",
    number: "215/203",
    rarity: "Secret Rare",
    language: "EN",
  },
  grade: "RAW",
  compMedianPence: 28500,
  condition: "Near Mint",
};

const slabInput = {
  card: {
    name: "Charizard ex",
    setName: "151",
    number: "199/165",
    rarity: "Special Illustration Rare",
    language: "EN",
  },
  grade: "PSA_10",
  compMedianPence: 106220,
  costBasisPence: 70000,
  certNumber: "84213567",
};

test("buildInventoryItemPayload produces trading-card condition descriptors for raw cards", () => {
  const item = buildInventoryItemPayload(rawInput, 1);
  assert.equal(item.condition, "USED_VERY_GOOD");
  assert.deepEqual(item.conditionDescriptors, [{ name: "40001", values: ["400010"] }]);
  assert.match(item.product.title, /Umbreon VMAX/);
  assert.deepEqual(item.availability.shipToLocationAvailability, { quantity: 1 });
  assert.equal(item.product.aspects["Game"]?.[0], "Pokémon TCG");
  assert.equal(item.product.aspects["Card Name"]?.[0], "Umbreon VMAX");
});

test("buildInventoryItemPayload produces trading-card condition descriptors for PSA slab", () => {
  const item = buildInventoryItemPayload(slabInput, 1);
  assert.equal(item.condition, "LIKE_NEW");
  assert.deepEqual(item.conditionDescriptors, [
    { name: "27501", values: ["275010"] },
    { name: "27502", values: ["275020"] },
    { name: "27503", values: ["84213567"] },
  ]);
  assert.match(item.product.title, /Charizard ex/);
  assert.equal(item.product.aspects["Professional Grader"]?.[0], "PSA");
  assert.equal(item.product.aspects["Grade"]?.[0], "10");
});

test("buildInventoryItemPayload includes image URL when provided", () => {
  const item = buildInventoryItemPayload(rawInput, 1, "https://images.pokemontcg.io/swsh7/215_hires.png");
  assert.deepEqual(item.product.imageUrls, ["https://images.pokemontcg.io/swsh7/215_hires.png"]);
});

test("buildInventoryItemPayload omits imageUrls when no image provided", () => {
  const item = buildInventoryItemPayload(rawInput, 1, null);
  assert.equal(item.product.imageUrls, undefined);
});

test("buildInventoryItemPayload clamps quantity to at least 1", () => {
  const item = buildInventoryItemPayload(rawInput, 0);
  assert.equal(item.availability.shipToLocationAvailability.quantity, 1);
});

test("upsertInventoryItem sends eBay-required language header", async () => {
  let capturedHeaders: Record<string, string> = {};
  const fetch: typeof globalThis.fetch = (_url, opts) => {
    capturedHeaders = opts?.headers as Record<string, string>;
    return Promise.resolve({
      ok: true,
      status: 204,
      text: () => Promise.resolve(""),
    } as Response);
  };

  await upsertInventoryItem(
    TEST_CONFIG,
    "pdos-test",
    buildInventoryItemPayload(rawInput, 1),
    "access-token",
    fetch,
  );

  assert.equal(capturedHeaders["Content-Language"], "en-GB");
  assert.equal(capturedHeaders["Content-Type"], "application/json");
});

// ── Offer payload ─────────────────────────────────────────────────────────────

test("buildOfferPayload uses correct marketplace and currency", () => {
  const pack = buildListingPack(slabInput);
  const offer = buildOfferPayload("pdos-abc", pack, MOCK_POLICIES, TEST_CONFIG);

  assert.equal(offer.sku, "pdos-abc");
  assert.equal(offer.marketplaceId, "EBAY_GB");
  assert.equal(offer.format, "FIXED_PRICE");
  assert.equal(offer.pricingSummary.price.currency, "GBP");
  assert.equal(offer.listingPolicies.paymentPolicyId, "pay-001");
  assert.equal(offer.listingPolicies.fulfillmentPolicyId, "ship-001");
  assert.equal(offer.listingPolicies.returnPolicyId, "ret-001");
  assert.equal(offer.merchantLocationKey, "uk-loc-1");
  assert.equal(offer.categoryId, EBAY_UK_CATEGORY_POKEMON);
});

test("buildOfferPayload price is correct GBP from pence", () => {
  const pack = buildListingPack({ ...slabInput, listPricePence: 9999 });
  const offer = buildOfferPayload("pdos-xyz", pack, MOCK_POLICIES, TEST_CONFIG);
  assert.equal(offer.pricingSummary.price.value, "99.99");
});

test("buildOfferPayload carries listing quantity and clamps to one", () => {
  const pack = buildListingPack(slabInput);
  assert.equal(buildOfferPayload("pdos-many", pack, MOCK_POLICIES, TEST_CONFIG, 3).availableQuantity, 3);
  assert.equal(buildOfferPayload("pdos-zero", pack, MOCK_POLICIES, TEST_CONFIG, 0).availableQuantity, 1);
});

test("buildOfferPayload omits merchantLocationKey when null", () => {
  const pack = buildListingPack(slabInput);
  const noloc = { ...MOCK_POLICIES, merchantLocationKey: null };
  const offer = buildOfferPayload("pdos-xyz", pack, noloc, TEST_CONFIG);
  assert.equal(offer.merchantLocationKey, undefined);
});

test("toEbaySku creates stable app-owned SKUs", () => {
  assert.equal(toEbaySku("listing-123"), "pdos-listing-123");
});

test("buildEbayOfferPreflight previews inventory and offer payloads without writing", () => {
  const preflight = buildEbayOfferPreflight({
    listingId: "listing-123",
    packInput: slabInput,
    quantity: 2,
    imageUrl: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
    policies: MOCK_POLICIES,
    config: TEST_CONFIG,
  });

  assert.equal(preflight.sku, "pdos-listing-123");
  assert.equal(preflight.quantity, 2);
  assert.equal(preflight.priceGbp, "1063.00");
  assert.equal(preflight.marketplaceId, "EBAY_GB");
  assert.equal(preflight.policyKeys.paymentPolicyId, true);
  assert.equal(preflight.policyKeys.fulfillmentPolicyId, true);
  assert.equal(preflight.policyKeys.returnPolicyId, true);
  assert.equal(preflight.policyKeys.merchantLocationKey, true);
  assert.deepEqual(preflight.inventoryItem.product.imageUrls, ["https://images.pokemontcg.io/sv3pt5/199_hires.png"]);
  assert.equal(preflight.offer.sku, preflight.sku);
  assert.equal(preflight.offer.availableQuantity, 2);
  assert.equal(preflight.offer.pricingSummary.price.currency, "GBP");
});

// ── merchant location setup ───────────────────────────────────────────────────

test("readEbayLocationSetup reads the seller location from env-style config", () => {
  const setup = readEbayLocationSetup({
    EBAY_MERCHANT_LOCATION_KEY: "  pdos-home  ",
    EBAY_LOCATION_NAME: "  Pokémon stock room  ",
    EBAY_LOCATION_ADDRESS_LINE1: "  10 Test Street  ",
    EBAY_LOCATION_CITY: "  Manchester  ",
    EBAY_LOCATION_POSTAL_CODE: "  M1 1AA  ",
  });

  assert.deepEqual(setup, {
    merchantLocationKey: "pdos-home",
    name: "Pokémon stock room",
    address: {
      addressLine1: "10 Test Street",
      city: "Manchester",
      postalCode: "M1 1AA",
      country: "GB",
    },
  });
});

test("missingEbayLocationSetupFields reports required setup env vars", () => {
  assert.deepEqual(missingEbayLocationSetupFields({}), [
    "EBAY_MERCHANT_LOCATION_KEY",
    "EBAY_LOCATION_ADDRESS_LINE1",
    "EBAY_LOCATION_CITY",
    "EBAY_LOCATION_POSTAL_CODE",
  ]);
  assert.deepEqual(
    missingEbayLocationSetupFields({
      EBAY_MERCHANT_LOCATION_KEY: "pdos-home",
      EBAY_LOCATION_ADDRESS_LINE1: "10 Test Street",
      EBAY_LOCATION_CITY: "Manchester",
      EBAY_LOCATION_POSTAL_CODE: "M1 1AA",
    }),
    [],
  );
});

test("readEbayLocationSetupInput normalizes app-submitted seller location details", () => {
  const parsed = readEbayLocationSetupInput({
    name: "  James cards  ",
    merchantLocationKey: " Main stock room! ",
    addressLine1: "  10 Test Street ",
    addressLine2: " Flat 2 ",
    city: " Manchester ",
    postalCode: " m1 1aa ",
    country: "",
  });

  assert.deepEqual(parsed, {
    missingFields: [],
    setup: {
      merchantLocationKey: "main-stock-room",
      name: "James cards",
      address: {
        addressLine1: "10 Test Street",
        addressLine2: "Flat 2",
        city: "Manchester",
        postalCode: "M1 1AA",
        country: "GB",
      },
    },
  });
});

test("readEbayLocationSetupInput defaults merchant key and reports missing fields", () => {
  assert.deepEqual(readEbayLocationSetupInput({ addressLine1: "", city: "", postalCode: "" }), {
    setup: null,
    missingFields: ["addressLine1", "city", "postalCode"],
  });

  const parsed = readEbayLocationSetupInput({
    addressLine1: "10 Test Street",
    city: "Manchester",
    postalCode: "M1 1AA",
    country: "GBR",
  });

  assert.deepEqual(parsed, {
    setup: null,
    missingFields: ["country"],
  });

  assert.equal(
    readEbayLocationSetupInput({
      addressLine1: "10 Test Street",
      city: "Manchester",
      postalCode: "M1 1AA",
    }).setup?.merchantLocationKey,
    "pdos-main",
  );
});

test("buildInventoryLocationPayload creates an enabled warehouse location", () => {
  const setup = readEbayLocationSetup({
    EBAY_MERCHANT_LOCATION_KEY: "pdos-home",
    EBAY_LOCATION_ADDRESS_LINE1: "10 Test Street",
    EBAY_LOCATION_CITY: "Manchester",
    EBAY_LOCATION_POSTAL_CODE: "M1 1AA",
    EBAY_LOCATION_COUNTRY: "GB",
  })!;

  assert.deepEqual(buildInventoryLocationPayload(setup), {
    name: "Pokemon Dealer OS",
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
    location: {
      address: {
        addressLine1: "10 Test Street",
        city: "Manchester",
        postalCode: "M1 1AA",
        country: "GB",
      },
    },
  });
});

test("createInventoryLocation posts to the configured merchant location key", async () => {
  const setup = readEbayLocationSetup({
    EBAY_MERCHANT_LOCATION_KEY: "pdos-home",
    EBAY_LOCATION_ADDRESS_LINE1: "10 Test Street",
    EBAY_LOCATION_CITY: "Manchester",
    EBAY_LOCATION_POSTAL_CODE: "M1 1AA",
  })!;
  let capturedUrl = "";
  let capturedBody: unknown = null;
  const fetch: typeof globalThis.fetch = (url, opts) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(opts?.body));
    return Promise.resolve({
      ok: true,
      status: 204,
      text: () => Promise.resolve(""),
    } as Response);
  };

  const result = await createInventoryLocation(TEST_CONFIG, "token-xyz", setup, fetch);

  assert.equal(result.merchantLocationKey, "pdos-home");
  assert.equal(capturedUrl, "https://api.sandbox.ebay.com/sell/inventory/v1/location/pdos-home");
  assert.deepEqual(capturedBody, buildInventoryLocationPayload(setup));
});

// ── fetchEbayPolicies ─────────────────────────────────────────────────────────

test("fetchEbayPolicies maps first policy of each type", async () => {
  const fetch: typeof globalThis.fetch = (url) => {
    const path = String(url);
    if (path.includes("payment_policy")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ paymentPolicies: [{ paymentPolicyId: "PAY-123" }] }),
      } as Response);
    }
    if (path.includes("fulfillment_policy")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ fulfillmentPolicies: [{ fulfillmentPolicyId: "SHIP-456" }] }),
      } as Response);
    }
    if (path.includes("return_policy")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ returnPolicies: [{ returnPolicyId: "RET-789" }] }),
      } as Response);
    }
    if (path.includes("/location")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ locations: [{ merchantLocationKey: "LOC-GB" }] }),
      } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
  };

  const policies = await fetchEbayPolicies(TEST_CONFIG, "token-xyz", fetch);
  assert.equal(policies.paymentPolicyId, "PAY-123");
  assert.equal(policies.fulfillmentPolicyId, "SHIP-456");
  assert.equal(policies.returnPolicyId, "RET-789");
  assert.equal(policies.merchantLocationKey, "LOC-GB");
});

test("fetchEbayPolicies throws when payment policy is missing", async () => {
  const fetch: typeof globalThis.fetch = (url) => {
    const path = String(url);
    if (path.includes("payment_policy")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ paymentPolicies: [] }),
      } as Response);
    }
    if (path.includes("fulfillment_policy")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ fulfillmentPolicies: [{ fulfillmentPolicyId: "SHIP-456" }] }),
      } as Response);
    }
    if (path.includes("return_policy")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ returnPolicies: [{ returnPolicyId: "RET-789" }] }),
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ locations: [] }) } as Response);
  };

  await assert.rejects(
    () => fetchEbayPolicies(TEST_CONFIG, "token-xyz", fetch),
    /Missing required eBay business policies.*payment policy/,
  );
});

// ── checkEbayReadiness ────────────────────────────────────────────────────────

const READY_INPUT = {
  ebayConfigured: true,
  ebayConnected: true,
  channel: "EBAY",
  listingState: "DRAFT",
  pricePence: 5000,
  externalRef: null,
  hasImage: true,
};

test("checkEbayReadiness returns ready when all checks pass", () => {
  const result = checkEbayReadiness(READY_INPUT);
  assert.equal(result.ready, true);
  assert.equal(result.offerReady, true);
  assert.ok(result.checks.every((c) => c.status !== "fail"));
});

test("checkEbayReadiness allows preflight but blocks offer writes when merchant location is missing", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, hasMerchantLocation: false });

  assert.equal(result.ready, true);
  assert.equal(result.offerReady, false);
  const check = result.checks.find((c) => c.key === "merchant_location");
  assert.equal(check?.status, "warn");
  assert.match(check?.detail ?? "", /merchant location key/);
});

test("checkEbayReadiness fails when eBay not configured", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, ebayConfigured: false });
  assert.equal(result.ready, false);
  const check = result.checks.find((c) => c.key === "ebay_configured");
  assert.equal(check?.status, "fail");
});

test("checkEbayReadiness fails when eBay not connected", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, ebayConnected: false });
  assert.equal(result.ready, false);
  const check = result.checks.find((c) => c.key === "ebay_connected");
  assert.equal(check?.status, "fail");
});

test("checkEbayReadiness fails when price is zero", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, pricePence: 0 });
  assert.equal(result.ready, false);
  const check = result.checks.find((c) => c.key === "has_price");
  assert.equal(check?.status, "fail");
});

test("checkEbayReadiness fails when price is null", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, pricePence: null });
  assert.equal(result.ready, false);
  const check = result.checks.find((c) => c.key === "has_price");
  assert.equal(check?.status, "fail");
});

test("checkEbayReadiness fails when listing is already sold", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, listingState: "SOLD" });
  assert.equal(result.ready, false);
  const check = result.checks.find((c) => c.key === "not_sold");
  assert.equal(check?.status, "fail");
});

test("checkEbayReadiness fails when already published", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, externalRef: "123456789" });
  assert.equal(result.ready, false);
  const check = result.checks.find((c) => c.key === "not_published");
  assert.equal(check?.status, "fail");
});

test("checkEbayReadiness does not fail for pending offer state", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, externalRef: "offer:abc123" });
  assert.equal(result.ready, true);
  const check = result.checks.find((c) => c.key === "not_published");
  assert.equal(check?.status, "pass");
});

test("checkEbayReadiness fails when no image", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, hasImage: false });
  assert.equal(result.ready, false);
  const check = result.checks.find((c) => c.key === "has_image");
  assert.equal(check?.status, "fail");
});

test("checkEbayReadiness fails when channel is not EBAY", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, channel: "VINTED" });
  assert.equal(result.ready, false);
  const check = result.checks.find((c) => c.key === "channel_ebay");
  assert.equal(check?.status, "fail");
});
