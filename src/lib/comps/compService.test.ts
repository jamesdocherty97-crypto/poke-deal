import test from "node:test";
import assert from "node:assert/strict";
import { CompService, detectDisagreement, MemoryLastKnownCompCache, pickHeadline } from "./compService.js";
import type { CompResult } from "../domain/types.js";
import type { CompSource } from "./CompSource.js";

function comp(overrides: Partial<CompResult>): CompResult {
  return {
    source: "test-source",
    card: { name: "Charizard ex", setName: "151", number: "199/165" },
    grade: "RAW",
    currency: "GBP",
    medianPence: 3000,
    meanPence: 3000,
    lowPence: 2500,
    highPence: 3500,
    sampleSize: 8,
    windowDays: 90,
    trendPct: null,
    outliersRemoved: 0,
    asOf: "2026-06-22T00:00:00.000Z",
    ...overrides,
  };
}

test("pickHeadline prefers smart RAW price over a larger ordinary raw bucket", () => {
  const noisyRaw = comp({
    source: "pokemon-price-tracker",
    medianPence: 9000,
    sampleSize: 20,
    raw: { chosenPriceSource: "medianPrice" },
  });
  const smartRaw = comp({
    source: "pokemon-price-tracker",
    medianPence: 2800,
    sampleSize: 5,
    raw: { chosenPriceSource: "smartMarketPrice" },
  });

  assert.equal(pickHeadline([noisyRaw, smartRaw]), smartRaw);
});

test("pickHeadline uses catalog market baseline when raw eBay bucket disagrees without smart price", () => {
  const noisyRaw = comp({
    source: "pokemon-price-tracker",
    medianPence: 12000,
    sampleSize: 14,
    raw: { chosenPriceSource: "medianPrice" },
  });
  const catalogBaseline = comp({
    source: "pokemon-tcg-market",
    medianPence: 2400,
    meanPence: 2400,
    lowPence: 2400,
    highPence: 2400,
    sampleSize: 1,
    windowDays: 30,
    raw: { kind: "catalog-market-baseline" },
  });

  assert.equal(detectDisagreement([noisyRaw, catalogBaseline]), true);
  assert.equal(pickHeadline([noisyRaw, catalogBaseline]), catalogBaseline);
});

test("pickHeadline keeps smart RAW as the headline when market baselines disagree", () => {
  const smartRaw = comp({
    source: "pokemon-price-tracker",
    medianPence: 6500,
    sampleSize: 75,
    raw: { chosenPriceSource: "smartMarketPrice" },
  });
  const catalogBaseline = comp({
    source: "pokemon-tcg-market",
    medianPence: 4200,
    sampleSize: 1,
    windowDays: 30,
    raw: { kind: "catalog-market-baseline" },
  });

  assert.equal(detectDisagreement([smartRaw, catalogBaseline]), true);
  assert.equal(pickHeadline([smartRaw, catalogBaseline]), smartRaw);
});

test("pickHeadline uses strong PokeTrace RAW baseline when smart eBay is a high outlier", () => {
  const smartRaw = comp({
    source: "pokemon-price-tracker",
    medianPence: 6575,
    sampleSize: 76,
    raw: { chosenPriceSource: "smartMarketPrice" },
  });
  const pokeTraceBaseline = comp({
    source: "poketrace",
    medianPence: 4799,
    sampleSize: 6878,
    raw: { kind: "market-baseline", priceSource: "tcgplayer", tier: "NEAR_MINT" },
  });
  const catalogBaseline = comp({
    source: "pokemon-tcg-market",
    medianPence: 4000,
    sampleSize: 1,
    windowDays: 30,
    raw: { kind: "catalog-market-baseline", chosenSignal: { source: "cardmarket" } },
  });

  assert.equal(detectDisagreement([smartRaw, pokeTraceBaseline, catalogBaseline]), true);
  assert.equal(pickHeadline([smartRaw, pokeTraceBaseline, catalogBaseline]), pokeTraceBaseline);
});

test("pickHeadline prefers PokeTrace Cardmarket RAW baseline over catalog market baseline", () => {
  const smartRaw = comp({
    source: "pokemon-price-tracker",
    medianPence: 6575,
    sampleSize: 76,
    raw: { chosenPriceSource: "smartMarketPrice" },
  });
  const pokeTraceCardmarket = comp({
    source: "poketrace",
    medianPence: 4550,
    sampleSize: 12,
    raw: { kind: "market-baseline", priceSource: "cardmarket", tier: "NEAR_MINT" },
  });
  const catalogBaseline = comp({
    source: "pokemon-tcg-market",
    medianPence: 4000,
    sampleSize: 1,
    windowDays: 30,
    raw: { kind: "catalog-market-baseline", chosenSignal: { source: "cardmarket" } },
  });

  assert.equal(pickHeadline([smartRaw, pokeTraceCardmarket, catalogBaseline]), pokeTraceCardmarket);
});

test("pickHeadline keeps smart RAW when it agrees with the market baseline", () => {
  const smartRaw = comp({
    source: "pokemon-price-tracker",
    medianPence: 4400,
    sampleSize: 75,
    raw: { chosenPriceSource: "smartMarketPrice" },
  });
  const catalogBaseline = comp({
    source: "pokemon-tcg-market",
    medianPence: 4200,
    sampleSize: 1,
    windowDays: 30,
    raw: { kind: "catalog-market-baseline" },
  });

  assert.equal(detectDisagreement([smartRaw, catalogBaseline]), false);
  assert.equal(pickHeadline([smartRaw, catalogBaseline]), smartRaw);
});

test("pickHeadline uses PokeTrace raw market baseline when ordinary raw buckets disagree", () => {
  const noisyRaw = comp({
    source: "pokemon-price-tracker",
    medianPence: 11000,
    sampleSize: 20,
    raw: { chosenPriceSource: "medianPrice" },
  });
  const pokeTraceBaseline = comp({
    source: "poketrace",
    medianPence: 2600,
    sampleSize: 12,
    raw: { kind: "market-baseline", priceSource: "tcgplayer", tier: "NEAR_MINT" },
  });

  assert.equal(pickHeadline([noisyRaw, pokeTraceBaseline]), pokeTraceBaseline);
});

test("pickHeadline keeps confident graded comps on sample size", () => {
  const psaSmall = comp({ grade: "PSA_10", medianPence: 11000, sampleSize: 4 });
  const psaLarge = comp({ grade: "PSA_10", medianPence: 11500, sampleSize: 10 });

  assert.equal(pickHeadline([psaSmall, psaLarge]), psaLarge);
});

test("pickHeadline anchors on owned sales over a much larger external sample", () => {
  const ownedSale = comp({
    source: "owned-sales",
    medianPence: 1800,
    sampleSize: 2,
    raw: { kind: "owned-sales" },
  });
  const bigExternal = comp({
    source: "pokemon-price-tracker",
    medianPence: 2500,
    sampleSize: 200,
    raw: { chosenPriceSource: "smartMarketPrice" },
  });

  assert.equal(pickHeadline([bigExternal, ownedSale]), ownedSale);
});

test("pickHeadline anchors on owned sales for graded cards too", () => {
  const ownedGraded = comp({
    source: "owned-sales",
    grade: "PSA_10",
    medianPence: 11000,
    sampleSize: 1,
    raw: { kind: "owned-sales" },
  });
  const externalGraded = comp({
    source: "pokemon-price-tracker",
    grade: "PSA_10",
    medianPence: 13000,
    sampleSize: 40,
  });

  assert.equal(pickHeadline([externalGraded, ownedGraded]), ownedGraded);
});

test("pickHeadline ignores an empty owned-sales signal", () => {
  const emptyOwned = comp({ source: "owned-sales", medianPence: 0, sampleSize: 0 });
  const external = comp({
    source: "pokemon-price-tracker",
    medianPence: 2500,
    sampleSize: 30,
    raw: { chosenPriceSource: "smartMarketPrice" },
  });

  assert.equal(pickHeadline([emptyOwned, external]), external);
});

test("CompService degrades a hanging source into a visible empty comp", async () => {
  const hangingSource: CompSource = {
    name: "slow-source",
    live: true,
    lookup: () => new Promise<CompResult>(() => undefined),
  };
  const service = new CompService([hangingSource], 5);

  const result = await service.lookup({ name: "Gengar" }, { grade: "RAW", windowDays: 30 });

  assert.equal(result.headline.source, "slow-source");
  assert.equal(result.headline.sampleSize, 0);
  assert.equal(result.headline.windowDays, 30);
  assert.match((result.headline.raw as { reason?: string }).reason ?? "", /timed out/);
});

test("CompService records a timed-out source while using remaining priced sources", async () => {
  const hangingSource: CompSource = {
    name: "slow-source",
    live: true,
    lookup: () => new Promise<CompResult>(() => undefined),
  };
  const pricedSource: CompSource = {
    name: "priced-source",
    live: true,
    lookup: async () => comp({ source: "priced-source", medianPence: 4200, sampleSize: 12 }),
  };
  const service = new CompService([hangingSource, pricedSource], 5);

  const result = await service.lookup({ name: "Gengar" }, { grade: "RAW", windowDays: 30 });

  assert.equal(result.headline.source, "priced-source");
  assert.equal(result.headline.medianPence, 4200);
  assert.equal(result.unavailableSources?.[0]?.name, "slow-source");
  assert.match(result.unavailableSources?.[0]?.reason ?? "", /timed out/);
});

test("CompService serves a warm cached comp when every source fails", async () => {
  const failingSource: CompSource = {
    name: "failing-source",
    live: true,
    lookup: async () => {
      throw new Error("network down");
    },
  };
  const cachedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const cachedHeadline = comp({
    source: "pokemon-price-tracker",
    card: { name: "Gengar", setName: "Lost Origin", number: "TG06/TG30" },
    medianPence: 2500,
    sampleSize: 8,
  });
  const cache = new MemoryLastKnownCompCache([{ headline: cachedHeadline, cachedAt }]);
  const service = new CompService([failingSource], 5, cache);

  const result = await service.lookup(cachedHeadline.card, { grade: "RAW", windowDays: 30 });

  assert.equal(result.headline.medianPence, 2500);
  assert.equal(result.cached?.ageHours, 3);
  assert.equal((result.headline.raw as { cached?: boolean }).cached, true);
  assert.equal(result.unavailableSources?.[0]?.name, "failing-source");
});

test("CompService returns a clean no-data result when every source fails cold", async () => {
  const failingSource: CompSource = {
    name: "failing-source",
    live: true,
    lookup: async () => {
      throw new Error("network down");
    },
  };
  const service = new CompService([failingSource], 5);

  const result = await service.lookup({ name: "Gengar" }, { grade: "RAW", windowDays: 30 });

  assert.equal(result.headline.sampleSize, 0);
  assert.equal(result.cached, undefined);
  assert.equal(result.reconciliation?.manualCheck, true);
  assert.equal(result.unavailableSources?.[0]?.name, "failing-source");
});
