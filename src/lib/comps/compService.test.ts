import test from "node:test";
import assert from "node:assert/strict";
import {
  CompService,
  defaultCompSources,
  detectDisagreement,
  MemoryLastKnownCompCache,
  pickHeadline,
  pickHeadlineForQuery,
} from "./compService.js";
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

test("PokeTrace internal signals cannot lend their sample size to the chosen eBay aggregate", () => {
  const pokeTraceSolds = comp({
    source: "poketrace",
    card: { name: "Victini", setName: "Scarlet & Violet Black Star Promos", number: "SVP208" },
    medianPence: 1347,
    meanPence: 1347,
    lowPence: 1347,
    highPence: 1347,
    sampleSize: 289,
    trendPct: 6,
    raw: {
      kind: "sold-aggregate",
      priceSource: "ebay",
      tier: "NEAR_MINT",
      market: "US",
      providerCard: {
        name: "Victini - 208",
        setName: "SV: Scarlet & Violet Promo Cards",
        number: "208",
        language: "EN",
      },
      signals: [
        { priceSource: "tcgplayer", medianPence: 1326, sampleSize: 24553 },
        { priceSource: "ebay", medianPence: 1347, sampleSize: 289 },
      ],
    },
  });

  const result = pickHeadlineForQuery(
    [pokeTraceSolds],
    { name: "Victini", setName: "Scarlet & Violet Black Star Promos", number: "SVP208" },
    { grade: "RAW" },
  );

  assert.equal(result.headline?.source, "poketrace");
  assert.equal(result.headline?.sampleSize, 289);
  assert.equal(result.reconciliation.headlinePence, 1347);
  assert.equal(result.reconciliation.confidence, "medium");
  assert.equal(result.reconciliation.manualCheck, false);
  assert.equal(result.reconciliation.selection?.sampleSize, 289);
  assert.doesNotMatch(result.reconciliation.reasons.join(" "), /n-boosted-by-agreeing-signals/);
});

test("a reconciler median correction remains inside the returned source range", () => {
  const catalog = comp({
    source: "pokemon-tcg-market",
    card: { name: "Charizard ex", setName: "151", number: "199/165" },
    medianPence: 357_600,
    meanPence: 357_600,
    lowPence: 357_600,
    highPence: 357_600,
    sampleSize: 1,
    windowDays: 30,
    raw: {
      kind: "catalog-market-baseline",
      chosenSignal: { source: "cardmarket" },
      signals: [
        { source: "cardmarket", kind: "trendPrice", pricePence: 357_600 },
        { source: "cardmarket", kind: "avg30", pricePence: 207_500 },
      ],
    },
  });

  const result = pickHeadlineForQuery([catalog], catalog.card, { grade: "RAW" });

  assert.equal(result.headline?.medianPence, 207_500);
  assert.ok((result.headline?.lowPence ?? 0) <= 207_500);
  assert.ok((result.headline?.highPence ?? 0) >= 207_500);
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

test("defaultCompSources dark-launches eBay Marketplace Insights behind an env flag", () => {
  const originalShort = process.env.EBAY_INSIGHTS_ENABLED;
  const originalLegacy = process.env.EBAY_MARKETPLACE_INSIGHTS_ENABLED;
  try {
    delete process.env.EBAY_INSIGHTS_ENABLED;
    delete process.env.EBAY_MARKETPLACE_INSIGHTS_ENABLED;
    assert.equal(defaultCompSources().some((source) => source.name === "ebay-marketplace-insights"), false);

    process.env.EBAY_INSIGHTS_ENABLED = "true";
    assert.equal(defaultCompSources().some((source) => source.name === "ebay-marketplace-insights"), true);

    process.env.EBAY_INSIGHTS_ENABLED = "false";
    process.env.EBAY_MARKETPLACE_INSIGHTS_ENABLED = "true";
    assert.equal(defaultCompSources().some((source) => source.name === "ebay-marketplace-insights"), true);
  } finally {
    restoreEnv("EBAY_INSIGHTS_ENABLED", originalShort);
    restoreEnv("EBAY_MARKETPLACE_INSIGHTS_ENABLED", originalLegacy);
  }
});

test("CompService degrades a hanging source into a visible empty comp", async () => {
  const hangingSource: CompSource = {
    name: "slow-source",
    live: true,
    lookup: () => new Promise<CompResult>(() => undefined),
  };
  const service = new CompService([hangingSource], 5);

  const result = await service.lookup({ name: "Gengar" }, { grade: "RAW", windowDays: 30 });

  assert.equal(result.headline, null);
  assert.equal(result.all[0]?.source, "slow-source");
  assert.equal(result.all[0]?.sampleSize, 0);
  assert.equal(result.all[0]?.windowDays, 30);
  assert.match((result.all[0]?.raw as { reason?: string }).reason ?? "", /timed out/);
  assert.equal(result.reconciliation?.manualCheck, true);
});

test("CompService aborts the underlying source when its orchestration budget expires", async () => {
  let signal: AbortSignal | undefined;
  const source: CompSource = {
    name: "abort-aware-source",
    live: true,
    lookup: async (_card, _query, context) => {
      signal = context?.signal;
      return await new Promise<CompResult>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  };
  await new CompService([source], 5).lookup({ name: "Gengar" });
  assert.equal(signal?.aborted, true);
});

test("CompService records a timed-out source while using remaining priced sources", async () => {
  const hangingSource: CompSource = {
    name: "slow-source",
    live: true,
    lookup: () => new Promise<CompResult>(() => undefined),
  };
  const pricedSource: CompSource = {
    name: "poketrace",
    live: true,
    lookup: async () => comp({ source: "poketrace", medianPence: 4200, sampleSize: 12 }),
  };
  const service = new CompService([hangingSource, pricedSource], 5);

  const result = await service.lookup({ name: "Gengar" }, { grade: "RAW", windowDays: 30 });

  assert.ok(result.headline);
  assert.equal(result.headline.source, "poketrace");
  assert.equal(result.headline.medianPence, 4200);
  assert.equal(result.unavailableSources?.[0]?.name, "slow-source");
  assert.match(result.unavailableSources?.[0]?.reason ?? "", /timed out/);
});

test("CompService reports each source as it settles with a complete provisional receipt", async () => {
  const progress: Array<{ source: string; completed: number; priced: boolean; sampleSize: number }> = [];
  const first: CompSource = {
    name: "checked-comps",
    live: true,
    lookup: async () => comp({ source: "checked-comps", medianPence: 4000, sampleSize: 4 }),
  };
  const second: CompSource = {
    name: "poketrace",
    live: true,
    lookup: async () => comp({ source: "poketrace", medianPence: 4100, sampleSize: 12 }),
  };

  const result = await new CompService([first, second], 100).lookup(
    { name: "Charizard ex", setName: "151", number: "199/165" },
    { grade: "RAW" },
    {
      onProgress(event) {
        progress.push({
          source: event.source.name,
          completed: event.completed,
          priced: Boolean(event.receipt.headline),
          sampleSize: event.result.sampleSize,
        });
      },
    },
  );

  assert.equal(progress.length, 2);
  assert.deepEqual(progress.map((event) => event.completed).sort(), [1, 2]);
  assert.ok(progress.every((event) => event.priced && event.sampleSize > 0));
  assert.equal(result.all.length, 2);
});

test("CompService keeps unavailable reasons visible for every comp source family", async () => {
  const unavailableNames = [
    "pokemon-price-tracker",
    "ebay-marketplace-insights",
    "poketrace",
    "pokemon-tcg-market",
    "checked-comps",
  ];
  const failingSources: CompSource[] = unavailableNames.map((name) => ({
    name,
    live: true,
    lookup: async () => {
      throw new Error(`${name} provider down`);
    },
  }));
  const ownedSales: CompSource = {
    name: "owned-sales",
    live: true,
    lookup: async () => comp({ source: "owned-sales", medianPence: 1800, sampleSize: 2 }),
  };
  const service = new CompService([...failingSources, ownedSales], 25);

  const result = await service.lookup({ name: "Victini", setName: "Scarlet & Violet Promos", number: "SVP 208" }, { grade: "RAW", windowDays: 30 });

  assert.equal(result.all.some((candidate) => candidate.source === "owned-sales" && candidate.medianPence === 1800), true);
  assert.deepEqual(result.unavailableSources?.map((source) => source.name).sort(), unavailableNames.sort());
  for (const source of result.unavailableSources ?? []) {
    assert.match(source.reason, /failed|provider down/);
  }
  assert.equal(result.all.length, unavailableNames.length + 1);
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

  assert.ok(result.headline);
  assert.equal(result.headline.medianPence, 2500);
  assert.equal(result.cached?.ageHours, 3);
  assert.equal((result.headline.raw as { cached?: boolean }).cached, true);
  assert.equal(result.unavailableSources?.[0]?.name, "failing-source");
});

test("CompService preserves cached source disagreement independently of manual-check", async () => {
  const failingSource: CompSource = {
    name: "failing-source",
    live: true,
    lookup: async () => {
      throw new Error("network down");
    },
  };
  const cachedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const cachedHeadline = comp({
    source: "pokemon-price-tracker",
    card: { name: "Gengar", setName: "Lost Origin", number: "TG06/TG30" },
    medianPence: 2_500,
    sampleSize: 8,
  });
  const cache = new MemoryLastKnownCompCache([{
    headline: cachedHeadline,
    reconciliation: {
      headlinePence: 2_500,
      confidence: "medium",
      manualCheck: false,
      reasons: [],
      trendPct: null,
    },
    sourcesDisagree: true,
    cachedAt,
  }]);
  const result = await new CompService([failingSource], 5, cache).lookup(
    cachedHeadline.card,
    { grade: "RAW", windowDays: 30 },
  );

  assert.equal(result.reconciliation?.manualCheck, false);
  assert.equal(result.sourcesDisagree, true);
});

test("CompService ignores a warm cached row with no price", async () => {
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
    medianPence: 0,
    meanPence: 0,
    lowPence: 0,
    highPence: 0,
    sampleSize: 0,
  });
  const cache = new MemoryLastKnownCompCache([{ headline: cachedHeadline, cachedAt }]);
  const service = new CompService([failingSource], 5, cache);

  const result = await service.lookup(cachedHeadline.card, { grade: "RAW", windowDays: 30 });

  assert.equal(result.headline, null);
  assert.equal(result.cached, undefined);
  assert.equal(result.reconciliation?.manualCheck, true);
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

  assert.equal(result.headline, null);
  assert.equal(result.cached, undefined);
  assert.equal(result.reconciliation?.manualCheck, true);
  assert.equal(result.unavailableSources?.[0]?.name, "failing-source");
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
