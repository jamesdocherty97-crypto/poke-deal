import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildAuthUrl, exchangeCodeForTokens, refreshAccessToken } from "./oauth.js";
import { ebayJson } from "./client.js";
import { buildInventoryItemPayload, upsertInventoryItem } from "./inventoryItem.js";
import { buildOfferPayload } from "./offer.js";
import { buildEbayOfferPreflight, toEbaySku } from "./preflight.js";
import {
  EbayTradingApiError,
  buildTradingFixedPriceItemXml,
  buildTradingVerifyFixedPriceItemXml,
  parseTradingApiResult,
  verifyTradingFixedPriceItem,
} from "./trading.js";
import { getAccessToken, getApplicationAccessToken, clearTokenCache } from "./tokens.js";
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

test("ebayJson includes eBay errorId and long message on failure", async () => {
  const fetch = mockFetch(400, {
    errors: [
      {
        errorId: 25002,
        domain: "API_INVENTORY",
        category: "REQUEST",
        message: "Invalid request",
        longMessage: "Merchant location key is invalid.",
      },
    ],
  });

  await assert.rejects(
    () => ebayJson(TEST_CONFIG, "/sell/inventory/v1/offer", "token-xyz", {}, fetch),
    /Merchant location key is invalid\. \(errorId 25002\)/,
  );
});

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

test("getApplicationAccessToken uses client credentials and caches the token", async () => {
  let callCount = 0;
  let capturedBody = "";
  const fetch: typeof globalThis.fetch = (_url, opts) => {
    callCount++;
    capturedBody = String(opts?.body ?? "");
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ access_token: "app-token", expires_in: 7200 }),
    } as Response);
  };

  const token = await getApplicationAccessToken(TEST_CONFIG, fetch);
  const token2 = await getApplicationAccessToken(TEST_CONFIG, fetch);

  assert.equal(token, "app-token");
  assert.equal(token2, "app-token");
  assert.equal(callCount, 1);
  assert.match(capturedBody, /grant_type=client_credentials/);
  assert.match(capturedBody, /scope=https%3A%2F%2Fapi\.ebay\.com%2Foauth%2Fapi_scope/);
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

test("buildInventoryItemPayload includes ordered item photo URLs when provided", () => {
  const item = buildInventoryItemPayload(rawInput, 1, [
    "https://blob.vercel-storage.com/front.jpg",
    "https://blob.vercel-storage.com/back.jpg",
  ]);
  assert.deepEqual(item.product.imageUrls, [
    "https://blob.vercel-storage.com/front.jpg",
    "https://blob.vercel-storage.com/back.jpg",
  ]);
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
    imageUrls: ["https://blob.vercel-storage.com/charizard-front.jpg"],
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
  assert.equal(preflight.policySummary.payment.id, "pay-001");
  assert.equal(preflight.policySummary.fulfillment.id, "ship-001");
  assert.equal(preflight.policySummary.returns.id, "ret-001");
  assert.equal(preflight.policySummary.merchantLocation.key, "uk-loc-1");
  assert.deepEqual(preflight.inventoryItem.product.imageUrls, ["https://blob.vercel-storage.com/charizard-front.jpg"]);
  assert.equal(preflight.offer.sku, preflight.sku);
  assert.equal(preflight.offer.availableQuantity, 2);
  assert.equal(preflight.offer.pricingSummary.price.currency, "GBP");
});

test("buildEbayOfferPreflight reports missing item photos", () => {
  const preflight = buildEbayOfferPreflight({
    listingId: "listing-no-photo",
    packInput: slabInput,
    quantity: 1,
    imageUrls: [],
    policies: MOCK_POLICIES,
    config: TEST_CONFIG,
  });

  assert.equal(preflight.hasImage, false);
  assert.equal(preflight.inventoryItem.product.imageUrls, undefined);
});

// ── Trading API fallback ─────────────────────────────────────────────────────

test("buildTradingFixedPriceItemXml emits UK fixed-price card listing fields", () => {
  const xml = buildTradingFixedPriceItemXml({
    listingId: "pdos-listing-123",
    packInput: rawInput,
    quantity: 1,
    imageUrls: ["https://img.example.com/umbreon-front.jpg"],
    policies: MOCK_POLICIES,
    location: "Glasgow",
    postalCode: "G14 9QL",
  });

  assert.match(xml, /<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">/);
  assert.match(xml, /<CategoryID>183454<\/CategoryID>/);
  assert.match(xml, /<Currency>GBP<\/Currency>/);
  assert.match(xml, /<ListingType>FixedPriceItem<\/ListingType>/);
  assert.match(xml, /<ConditionID>4000<\/ConditionID>/);
  assert.match(xml, /<Name>40001<\/Name>\s*<Value>400010<\/Value>/);
  assert.match(xml, /<PictureURL>https:\/\/img\.example\.com\/umbreon-front\.jpg<\/PictureURL>/);
  assert.match(xml, /<PaymentProfileID>pay-001<\/PaymentProfileID>/);
  assert.match(xml, /<ReturnProfileID>ret-001<\/ReturnProfileID>/);
  assert.match(xml, /<ShippingProfileID>ship-001<\/ShippingProfileID>/);
});

test("buildTradingFixedPriceItemXml emits graded descriptors and cert additional info", () => {
  const xml = buildTradingFixedPriceItemXml({
    listingId: "pdos-slab-123",
    packInput: slabInput,
    quantity: 1,
    imageUrls: ["https://img.example.com/zard-slab.jpg"],
    policies: MOCK_POLICIES,
  });

  assert.match(xml, /<ConditionID>2750<\/ConditionID>/);
  assert.match(xml, /<Name>27501<\/Name>\s*<Value>275010<\/Value>/);
  assert.match(xml, /<Name>27502<\/Name>\s*<Value>275020<\/Value>/);
  assert.match(xml, /<Name>27503<\/Name>\s*<AdditionalInfo>84213567<\/AdditionalInfo>/);
});

test("buildTradingVerifyFixedPriceItemXml swaps the Trading API request wrapper", () => {
  const xml = buildTradingVerifyFixedPriceItemXml({
    listingId: "pdos-listing-123",
    packInput: rawInput,
    quantity: 1,
    imageUrls: ["https://img.example.com/umbreon-front.jpg"],
    policies: MOCK_POLICIES,
  });

  assert.match(xml, /<VerifyAddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">/);
  assert.doesNotMatch(xml, /<AddFixedPriceItemRequest xmlns=/);
  assert.match(xml, /<\/VerifyAddFixedPriceItemRequest>/);
});

test("parseTradingApiResult captures ack item id and errors", () => {
  const result = parseTradingApiResult(`
    <AddFixedPriceItemResponse>
      <Ack>Warning</Ack>
      <ItemID>1234567890</ItemID>
      <Errors>
        <ShortMessage>Funds on hold.</ShortMessage>
        <LongMessage>Funds from your sales may be unavailable.</LongMessage>
        <ErrorCode>21917236</ErrorCode>
        <SeverityCode>Warning</SeverityCode>
      </Errors>
    </AddFixedPriceItemResponse>
  `);

  assert.equal(result.ack, "Warning");
  assert.equal(result.itemId, "1234567890");
  assert.deepEqual(result.errors[0], {
    severity: "Warning",
    code: "21917236",
    shortMessage: "Funds on hold.",
    longMessage: "Funds from your sales may be unavailable.",
  });
});

test("verifyTradingFixedPriceItem throws Trading API error with eBay error code", async () => {
  const fetch: typeof globalThis.fetch = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`
        <VerifyAddFixedPriceItemResponse>
          <Ack>Failure</Ack>
          <Errors>
            <ShortMessage>Missing picture.</ShortMessage>
            <LongMessage>Picture URL is required.</LongMessage>
            <ErrorCode>21916603</ErrorCode>
            <SeverityCode>Error</SeverityCode>
          </Errors>
        </VerifyAddFixedPriceItemResponse>
      `),
    } as Response);

  await assert.rejects(
    () => verifyTradingFixedPriceItem(
      TEST_CONFIG,
      "token-xyz",
      {
        listingId: "pdos-test",
        packInput: rawInput,
        quantity: 1,
        imageUrls: [],
        policies: MOCK_POLICIES,
      },
      fetch,
    ),
    (error) => {
      assert.equal(error instanceof EbayTradingApiError, true);
      assert.match((error as Error).message, /Picture URL is required\. \(errorId 21916603\)/);
      return true;
    },
  );
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

test("readEbayLocationSetup defaults the merchant key when the env key is omitted", () => {
  const setup = readEbayLocationSetup({
    EBAY_LOCATION_ADDRESS_LINE1: "10 Test Street",
    EBAY_LOCATION_CITY: "Manchester",
    EBAY_LOCATION_POSTAL_CODE: "M1 1AA",
  });

  assert.equal(setup?.merchantLocationKey, "pdos-main");
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
    name: "Poke Deal",
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
  const savedKey = process.env.EBAY_MERCHANT_LOCATION_KEY;
  delete process.env.EBAY_MERCHANT_LOCATION_KEY;
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
  if (savedKey) process.env.EBAY_MERCHANT_LOCATION_KEY = savedKey;
});

test("fetchEbayPolicies picks eBay default policies and reports names", async () => {
  const savedKey = process.env.EBAY_MERCHANT_LOCATION_KEY;
  delete process.env.EBAY_MERCHANT_LOCATION_KEY;
  const fetch: typeof globalThis.fetch = (url) => {
    const path = String(url);
    if (path.includes("payment_policy")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          paymentPolicies: [
            { paymentPolicyId: "PAY-OLD", name: "Old payment" },
            { paymentPolicyId: "PAY-DEFAULT", name: "Default payment", categoryTypes: [{ default: true }] },
          ],
        }),
      } as Response);
    }
    if (path.includes("fulfillment_policy")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          fulfillmentPolicies: [
            { fulfillmentPolicyId: "SHIP-OLD", name: "Old shipping" },
            { fulfillmentPolicyId: "SHIP-DEFAULT", name: "Default shipping", categoryTypes: [{ default: true }] },
          ],
        }),
      } as Response);
    }
    if (path.includes("return_policy")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          returnPolicies: [
            { returnPolicyId: "RET-OLD", name: "Old returns" },
            { returnPolicyId: "RET-DEFAULT", name: "Default returns", categoryTypes: [{ default: true }] },
          ],
        }),
      } as Response);
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ locations: [{ merchantLocationKey: "LOC-GB", name: "Glasgow", merchantLocationStatus: "ENABLED" }] }),
    } as Response);
  };

  const policies = await fetchEbayPolicies(TEST_CONFIG, "token-xyz", fetch);

  assert.equal(policies.paymentPolicyId, "PAY-DEFAULT");
  assert.equal(policies.paymentPolicy?.name, "Default payment");
  assert.equal(policies.paymentPolicy?.default, true);
  assert.equal(policies.fulfillmentPolicyId, "SHIP-DEFAULT");
  assert.equal(policies.returnPolicyId, "RET-DEFAULT");
  assert.deepEqual(policies.merchantLocation, {
    merchantLocationKey: "LOC-GB",
    name: "Glasgow",
    status: "ENABLED",
  });
  if (savedKey) process.env.EBAY_MERCHANT_LOCATION_KEY = savedKey;
});

test("fetchEbayPolicies reports when the configured merchant location is absent on eBay", async () => {
  const savedKey = process.env.EBAY_MERCHANT_LOCATION_KEY;
  process.env.EBAY_MERCHANT_LOCATION_KEY = "pdos-main";
  const fetch: typeof globalThis.fetch = (url) => {
    const path = String(url);
    if (path.includes("payment_policy")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ paymentPolicies: [{ paymentPolicyId: "PAY-123" }] }) } as Response);
    }
    if (path.includes("fulfillment_policy")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ fulfillmentPolicies: [{ fulfillmentPolicyId: "SHIP-456" }] }) } as Response);
    }
    if (path.includes("return_policy")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ returnPolicies: [{ returnPolicyId: "RET-789" }] }) } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ locations: [{ merchantLocationKey: "other-location" }] }) } as Response);
  };

  const policies = await fetchEbayPolicies(TEST_CONFIG, "token-xyz", fetch);

  assert.equal(policies.configuredMerchantLocationKey, "pdos-main");
  assert.equal(policies.configuredMerchantLocationFound, false);
  assert.equal(policies.merchantLocationKey, null);
  if (savedKey) process.env.EBAY_MERCHANT_LOCATION_KEY = savedKey;
  else delete process.env.EBAY_MERCHANT_LOCATION_KEY;
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
  assert.equal(result.publishReady, true);
  assert.ok(result.checks.every((c) => c.status !== "fail"));
});

test("checkEbayReadiness allows preflight but blocks offer writes when merchant location is missing", () => {
  const result = checkEbayReadiness({
    ...READY_INPUT,
    hasMerchantLocation: false,
    locationSetupConfigured: true,
    locationCreateAvailable: true,
    merchantLocationKey: "pdos-main",
  });

  assert.equal(result.ready, true);
  assert.equal(result.offerReady, false);
  assert.equal(result.publishReady, false);
  const check = result.checks.find((c) => c.key === "merchant_location");
  assert.equal(check?.status, "warn");
  assert.match(check?.detail ?? "", /pdos-main/);
  assert.match(check?.detail ?? "", /Create seller location/);
});

test("checkEbayReadiness reports missing seller-location env setup", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, hasMerchantLocation: false, locationSetupConfigured: false });
  const check = result.checks.find((c) => c.key === "merchant_location");
  assert.equal(result.offerReady, false);
  assert.match(check?.detail ?? "", /env vars are missing/);
});

test("checkEbayReadiness allows offer prep but blocks publish when seller registration is incomplete", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, sellerRegistrationCompleted: false });

  assert.equal(result.ready, true);
  assert.equal(result.offerReady, true);
  assert.equal(result.publishReady, false);
  const check = result.checks.find((c) => c.key === "seller_registration");
  assert.equal(check?.status, "warn");
  assert.match(check?.detail ?? "", /publish is blocked/);
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

test("checkEbayReadiness fails when no real item photo is attached", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, hasImage: false });
  assert.equal(result.ready, false);
  const check = result.checks.find((c) => c.key === "has_image");
  assert.equal(check?.status, "fail");
  assert.match(check?.detail ?? "", /real item photo/);
});

test("checkEbayReadiness fails when channel is not EBAY", () => {
  const result = checkEbayReadiness({ ...READY_INPUT, channel: "VINTED" });
  assert.equal(result.ready, false);
  const check = result.checks.find((c) => c.key === "channel_ebay");
  assert.equal(check?.status, "fail");
});
