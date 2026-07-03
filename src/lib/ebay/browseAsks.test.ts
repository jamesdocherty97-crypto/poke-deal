import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  attachAskEvidence,
  buildEbayAskQuery,
  buildEbayAskSearchPath,
  fetchEbayAskEvidence,
  mapBrowseAskListings,
  resetEbayAskCacheForTests,
  titleMatchesAskContext,
  undercutAskPence,
} from "./browseAsks.js";
import { clearTokenCache } from "./tokens.js";
import type { CardRef } from "../domain/types.js";

const rates = {
  asOf: "2026-07-03",
  perGbp: { GBP: 1, EUR: 1, USD: 1, JPY: 1 },
};

const moonbreon: CardRef = {
  name: "Umbreon VMAX",
  setName: "Evolving Skies",
  number: "215/203",
  game: "POKEMON",
  language: "EN",
};

const savedEnv = {
  clientId: process.env.EBAY_CLIENT_ID,
  clientSecret: process.env.EBAY_CLIENT_SECRET,
  ruName: process.env.EBAY_RU_NAME,
  env: process.env.EBAY_ENV,
  budget: process.env.EBAY_BROWSE_DAILY_LIMIT,
};

beforeEach(() => {
  resetEbayAskCacheForTests();
  clearTokenCache();
  process.env.EBAY_CLIENT_ID = "client";
  process.env.EBAY_CLIENT_SECRET = "secret";
  process.env.EBAY_RU_NAME = "Runame";
  process.env.EBAY_ENV = "sandbox";
  delete process.env.EBAY_BROWSE_DAILY_LIMIT;
});

afterEach(() => {
  restoreEnv("EBAY_CLIENT_ID", savedEnv.clientId);
  restoreEnv("EBAY_CLIENT_SECRET", savedEnv.clientSecret);
  restoreEnv("EBAY_RU_NAME", savedEnv.ruName);
  restoreEnv("EBAY_ENV", savedEnv.env);
  restoreEnv("EBAY_BROWSE_DAILY_LIMIT", savedEnv.budget);
});

test("buildEbayAskQuery uses UK-friendly raw and graded search wording", () => {
  assert.equal(
    buildEbayAskQuery(moonbreon, "RAW"),
    "Umbreon VMAX 215/203 Evolving Skies -PSA -BGS -CGC -ACE -SGC -graded",
  );
  assert.equal(
    buildEbayAskQuery({ name: "Zapdos ex", setName: "151", number: "192/165" }, "BGS_9_5"),
    "Zapdos ex 192/165 151 BGS 9.5",
  );
  assert.equal(
    buildEbayAskQuery({ name: "Victini", setName: "Scarlet & Violet Promos", number: "SVP208" }, "ACE_10"),
    "Victini SVP 208 Scarlet & Violet Promos ACE 10",
  );
});

test("buildEbayAskSearchPath targets eBay GB Pokemon category and live ask filters", () => {
  const path = buildEbayAskSearchPath("Umbreon VMAX", { limit: 5 });
  const url = new URL(`https://api.ebay.com${path}`);
  assert.equal(url.pathname, "/buy/browse/v1/item_summary/search");
  assert.equal(url.searchParams.get("category_ids"), "183454");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(url.searchParams.get("sort"), "price");
  assert.match(url.searchParams.get("filter") ?? "", /buyingOptions:\{FIXED_PRICE\|AUCTION\}/);
  assert.match(url.searchParams.get("filter") ?? "", /itemLocationCountry:GB/);
});

test("titleMatchesAskContext filters number, raw slab leakage and obvious bad listings", () => {
  assert.equal(titleMatchesAskContext("Pokemon Umbreon VMAX 215/203 Evolving Skies NM", moonbreon, "RAW"), true);
  assert.equal(titleMatchesAskContext("Pokemon Umbreon VMAX 214/203 Evolving Skies NM", moonbreon, "RAW"), false);
  assert.equal(titleMatchesAskContext("PSA 10 Umbreon VMAX 215/203 Evolving Skies", moonbreon, "RAW"), false);
  assert.equal(titleMatchesAskContext("Custom proxy Umbreon VMAX 215/203", moonbreon, "RAW"), false);
  assert.equal(titleMatchesAskContext("Umbreon VMAX 215/203 Evolving Skies Extended Binder Inserts", moonbreon, "RAW"), false);
  assert.equal(titleMatchesAskContext("Umbreon VMAX 215/203 Evolving Skies Secret Rare Holo Pokemon chance pack", moonbreon, "RAW"), false);
  assert.equal(titleMatchesAskContext("BGS 9.5 Zapdos ex 192/165 Pokemon 151", { name: "Zapdos ex", number: "192/165" }, "BGS_9_5"), true);
});

test("mapBrowseAskListings maps relevant GBP asks and sorts can use total price", () => {
  const rows = mapBrowseAskListings(
    {
      itemSummaries: [
        {
          itemId: "1",
          title: "Pokemon Umbreon VMAX 215/203 Evolving Skies NM",
          itemWebUrl: "https://www.ebay.co.uk/itm/1",
          price: { value: "1700.00", currency: "GBP" },
          shippingOptions: [{ shippingCost: { value: "3.50", currency: "GBP" } }],
          buyingOptions: ["FIXED_PRICE"],
          condition: "Ungraded",
        },
        {
          itemId: "2",
          title: "PSA 10 Umbreon VMAX 215/203 Evolving Skies",
          itemWebUrl: "https://www.ebay.co.uk/itm/2",
          price: { value: "2500.00", currency: "GBP" },
        },
      ],
    },
    moonbreon,
    "RAW",
    rates,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.totalPence, 170350);
  assert.equal(rows[0]!.shippingPence, 350);
});

test("fetchEbayAskEvidence uses app token, caches for one hour and applies the daily budget", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = (url) => {
    calls++;
    const href = String(url);
    if (href.includes("/identity/v1/oauth2/token")) {
      return Promise.resolve(Response.json({ access_token: "app-token", expires_in: 7200 }));
    }
    assert.match(href, /\/buy\/browse\/v1\/item_summary\/search/);
    return Promise.resolve(Response.json({
      itemSummaries: [
        {
          itemId: "ask-1",
          title: "Pokemon Umbreon VMAX 215/203 Evolving Skies NM",
          itemWebUrl: "https://www.ebay.co.uk/itm/ask-1",
          price: { value: "1700.00", currency: "GBP" },
          shippingOptions: [{ shippingCost: { value: "2.70", currency: "GBP" } }],
          buyingOptions: ["FIXED_PRICE"],
        },
      ],
    }));
  };

  const first = await fetchEbayAskEvidence(moonbreon, {
    grade: "RAW",
    fetchImpl,
    rates,
    now: new Date("2026-07-03T10:00:00.000Z"),
  });
  const second = await fetchEbayAskEvidence(moonbreon, {
    grade: "RAW",
    fetchImpl,
    rates,
    now: new Date("2026-07-03T10:30:00.000Z"),
  });

  assert.equal(first.lowestPence, 170270);
  assert.equal(first.undercutPence, 170170);
  assert.equal(second.cached, true);
  assert.equal(calls, 2, "one token call and one Browse call; second lookup is cached");

  resetEbayAskCacheForTests();
  clearTokenCache();
  process.env.EBAY_BROWSE_DAILY_LIMIT = "1";
  const withinBudget = await fetchEbayAskEvidence({ ...moonbreon, number: "215/203" }, {
    grade: "RAW",
    fetchImpl,
    rates,
    now: new Date("2026-07-03T11:00:00.000Z"),
  });
  const exhausted = await fetchEbayAskEvidence({ ...moonbreon, number: "216/203" }, {
    grade: "RAW",
    fetchImpl,
    rates,
    now: new Date("2026-07-03T11:05:00.000Z"),
  });

  assert.equal(withinBudget.skipped, undefined);
  assert.equal(exhausted.skipped, true);
  assert.match(exhausted.reason ?? "", /budget exhausted/i);
});

test("attachAskEvidence never changes reconciliation inputs or headline", () => {
  const comp = {
    headline: { source: "poketrace", medianPence: 1200 },
    all: [{ source: "poketrace" }],
    sourcesDisagree: false,
  };
  const evidence = {
    source: "ebay-browse" as const,
    marketplaceId: "EBAY_GB",
    query: "Victini SVP 208",
    asOf: "2026-07-03T10:00:00.000Z",
    count: 1,
    listings: [],
    lowestPence: 1500,
    undercutPence: 1400,
  };

  const attached = attachAskEvidence(comp, evidence);
  assert.equal(attached.headline, comp.headline);
  assert.equal(attached.all, comp.all);
  assert.equal(attached.askEvidence, evidence);
});

test("undercutAskPence subtracts one practical listing step", () => {
  assert.equal(undercutAskPence(1299), 1249);
  assert.equal(undercutAskPence(12_000), 11_900);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value == null) delete process.env[key];
  else process.env[key] = value;
}
