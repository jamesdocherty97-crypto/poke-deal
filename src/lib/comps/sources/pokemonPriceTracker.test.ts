import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gradeToProviderKey, mapCardAggregateToComp, PokemonPriceTrackerSource } from "./pokemonPriceTracker.js";
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
  const c = mapCardAggregateToComp(fixture, ctx("RAW"));
  assert.equal(c.currency, "GBP");
  assert.equal(c.sampleSize, 248);
  assert.equal(c.medianPence, usdToPence(392.5));
  assert.equal(c.meanPence, usdToPence(443.9269124423963));
  assert.equal(c.lowPence, usdToPence(2));
  assert.equal(c.highPence, usdToPence(1100));
  assert.equal(c.asOf, "2026-06-20T07:09:08.004Z");
  assert.equal((c.raw as { chosenPriceSource?: string }).chosenPriceSource, "smartMarketPrice");
});

test("PSA_10 maps from 'psa10' aggregate", () => {
  const c = mapCardAggregateToComp(fixture, ctx("PSA_10"));
  assert.equal(c.sampleSize, 249);
  assert.equal(c.medianPence, usdToPence(1349)); // ~106220
  assert.ok(c.medianPence > c.lowPence && c.highPence > c.medianPence);
});

test("PSA_9 maps from 'psa9' aggregate", () => {
  const c = mapCardAggregateToComp(fixture, ctx("PSA_9"));
  assert.equal(c.sampleSize, 334);
  assert.equal(c.medianPence, usdToPence(382.5));
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
