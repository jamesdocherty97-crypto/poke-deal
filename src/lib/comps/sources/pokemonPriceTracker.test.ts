import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildPokemonPriceTrackerSearch,
  gradeToProviderKey,
  mapCardAggregateToComp,
  normalizeProviderCollectorNumber,
  PokemonPriceTrackerSource,
} from "./pokemonPriceTracker.js";
import type { CardRef } from "../../domain/types.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/ppt-cards-ebay.json", import.meta.url)), "utf8"),
);

const card: CardRef = { name: "Charizard ex", number: "199/165", setName: "151" };
const ctx = (grade: any) => ({ source: "pokemon-price-tracker", card, grade, windowDays: 90 });

// USD→GBP at the static rate (1 GBP = 1.27 USD): pence = round(usd / 1.27 * 100)
const usdToPence = (usd: number) => Math.round((usd / 1.27) * 100);

test("gradeToProviderKey maps our grades to provider keys", () => {
  assert.equal(gradeToProviderKey("RAW"), "ungraded");
  assert.equal(gradeToProviderKey("PSA_10"), "psa10");
  assert.equal(gradeToProviderKey("PSA_9"), "psa9");
  assert.equal(gradeToProviderKey("BGS_9_5"), "bgs9_5");
  assert.equal(gradeToProviderKey("CGC_10"), "cgc10");
});

test("RAW prefers smartMarketPrice from noisy ungraded aggregate, converted to GBP", () => {
  assert.equal(Array.isArray(fixture.data), true, "captured v2 response should be array-shaped");
  assert.equal(fixture.metadata.limit, 1, "fixture should pin the low-credit request shape");
  const c = mapCardAggregateToComp(fixture, ctx("RAW"));
  assert.equal(c.currency, "GBP");
  assert.equal(c.sampleSize, 248);
  assert.equal(c.medianPence, usdToPence(392.5));
  assert.equal(c.meanPence, usdToPence(443.9269124423963));
  assert.equal(c.lowPence, usdToPence(2));
  assert.equal(c.highPence, usdToPence(1100));
  assert.equal(c.asOf, "2026-06-21T21:46:14.427Z");
  assert.equal((c.raw as { chosenPriceSource?: string; marketPrice7Day?: number }).chosenPriceSource, "smartMarketPrice");
  assert.equal((c.raw as { marketPrice7Day?: number }).marketPrice7Day, 453.7475);
});

test("buildPokemonPriceTrackerSearch expands prefixed subset numbers for provider matching", () => {
  assert.equal(
    buildPokemonPriceTrackerSearch({
      name: "Gengar",
      setName: "Lost Origin Trainer Gallery",
      number: "TG06/30",
    }),
    "Gengar TG06/TG30",
  );
  assert.equal(
    buildPokemonPriceTrackerSearch({
      name: "Gengar",
      setName: "Lost Origin",
      number: "TG06",
    }),
    "Gengar TG06/TG30",
  );
  assert.equal(normalizeProviderCollectorNumber("199/165", "151"), "199/165");
});

test("PokemonPriceTrackerSource live requests use provider-style prefixed numbers", async () => {
  let requestedUrlString: string | null = null;
  const fetchImpl = (async (url: string | URL | Request) => {
    requestedUrlString = String(url);
    return new Response(JSON.stringify(fixture), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const source = new PokemonPriceTrackerSource("secret", fetchImpl, 5);
  await source.lookup({ name: "Gengar", setName: "Lost Origin", number: "TG06/30" }, { grade: "RAW" });

  assert.ok(requestedUrlString);
  const requestedUrl = new URL(requestedUrlString);
  assert.equal(requestedUrl.searchParams.get("search"), "Gengar TG06/TG30");
  assert.equal(requestedUrl.searchParams.get("limit"), "1");
});

test("PSA_10 maps from 'psa10' aggregate", () => {
  const c = mapCardAggregateToComp(fixture, ctx("PSA_10"));
  assert.equal(c.sampleSize, 249);
  assert.equal(c.medianPence, usdToPence(1349)); // ~106220
  assert.equal((c.raw as { smartMarketPrice?: { price?: number } }).smartMarketPrice?.price, 1508.12);
  assert.ok(c.medianPence > c.lowPence && c.highPence > c.medianPence);
});

test("PSA_9 maps from 'psa9' aggregate", () => {
  const c = mapCardAggregateToComp(fixture, ctx("PSA_9"));
  assert.equal(c.sampleSize, 336);
  assert.equal(c.medianPence, usdToPence(392.5));
});

test("BGS_9_5 and CGC_10 map from current live aggregate keys", () => {
  const bgs = mapCardAggregateToComp(fixture, ctx("BGS_9_5"));
  const cgc = mapCardAggregateToComp(fixture, ctx("CGC_10"));

  assert.equal(bgs.sampleSize, 27);
  assert.equal(bgs.medianPence, usdToPence(749.99));
  assert.equal(cgc.sampleSize, 69);
  assert.equal(cgc.medianPence, usdToPence(800));
});

test("missing grade returns empty result, not an error", () => {
  const c = mapCardAggregateToComp(fixture, ctx("BGS_10"));
  assert.equal(c.sampleSize, 0);
  assert.equal(c.medianPence, 0);
  assert.equal(c.trendPct, null);
});

test("malformed payload returns empty result", () => {
  assert.equal(mapCardAggregateToComp(null, ctx("RAW")).sampleSize, 0);
  assert.equal(mapCardAggregateToComp({ data: {} }, ctx("RAW")).sampleSize, 0);
});

test("PokemonPriceTrackerSource degrades when live fetch fails or times out", async () => {
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.ok(init?.signal, "live requests should carry a timeout signal");
    throw new Error("network timeout");
  }) as typeof fetch;

  const source = new PokemonPriceTrackerSource("secret", fetchImpl, 5);
  const comp = await source.lookup(card, { grade: "RAW" });

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
});

test("PokemonPriceTrackerSource live requests use the low-credit limit and cap history days", async () => {
  let requestedUrlString: string | null = null;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.ok(init?.signal, "live requests should carry a timeout signal");
    requestedUrlString = String(url);
    return new Response(JSON.stringify(fixture), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const source = new PokemonPriceTrackerSource("secret", fetchImpl, 5);
  const comp = await source.lookup(card, { grade: "RAW", windowDays: 365 });

  assert.ok(requestedUrlString);
  const requestedUrl = new URL(requestedUrlString);
  assert.equal(comp.sampleSize, 248);
  assert.equal(requestedUrl.searchParams.get("limit"), "1");
  assert.equal(requestedUrl.searchParams.get("days"), "180");
  assert.equal(requestedUrl.searchParams.get("includeEbay"), "true");
  assert.equal(requestedUrl.searchParams.get("set"), "151");
});
