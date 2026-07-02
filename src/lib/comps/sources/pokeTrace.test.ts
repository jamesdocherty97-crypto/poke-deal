import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildPokeTraceSearchVariants,
  gradeToPokeTraceTier,
  mapPokeTraceCardsToComp,
  PokeTraceSource,
  resetPokeTraceSharedThrottleForTests,
} from "./pokeTrace.js";
import type { CardRef } from "../../domain/types.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/poketrace-cards.json", import.meta.url)), "utf8"),
);

const freeTierFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/poketrace-cards-free-tier.json", import.meta.url)), "utf8"),
);

const card: CardRef = { name: "Charizard ex", setName: "151", number: "199/165" };
const ctx = (grade: any) => ({ source: "poketrace", card, grade, windowDays: 90 });
const usdToPence = (usd: number) => Math.round((usd / 1.27) * 100);
const eurToPence = (eur: number) => Math.round((eur / 1.17) * 100);

test("gradeToPokeTraceTier maps raw and slab grades to PokeTrace tiers", () => {
  assert.equal(gradeToPokeTraceTier("RAW"), "NEAR_MINT");
  assert.equal(gradeToPokeTraceTier("PSA_10"), "PSA_10");
  assert.equal(gradeToPokeTraceTier("BGS_9_5"), "BGS_9_5");
  assert.equal(gradeToPokeTraceTier("ACE_10"), "ACE_10");
});

test("RAW maps the stable TCGPlayer near-mint baseline when present", () => {
  const comp = mapPokeTraceCardsToComp(fixture, ctx("RAW"));

  assert.equal(comp.source, "poketrace");
  assert.equal(comp.currency, "GBP");
  assert.equal(comp.card.name, "Charizard ex");
  assert.equal(comp.card.setName, "151");
  assert.equal(comp.sampleSize, 73);
  assert.equal(comp.medianPence, usdToPence(86));
  assert.equal(comp.lowPence, usdToPence(78));
  assert.equal(comp.highPence, usdToPence(96));
  assert.equal(comp.trendPct, 7.5);
  assert.equal(comp.asOf, "2026-01-29T12:00:00.000Z");
  assert.equal((comp.raw as { kind?: string }).kind, "market-baseline");
  assert.equal((comp.raw as { priceSource?: string }).priceSource, "tcgplayer");
});

test("graded cards map eBay sold aggregate tiers", () => {
  const comp = mapPokeTraceCardsToComp(fixture, ctx("PSA_10"));

  assert.equal(comp.sampleSize, 18);
  assert.equal(comp.medianPence, usdToPence(520));
  assert.equal(comp.lowPence, usdToPence(480));
  assert.equal(comp.highPence, usdToPence(575));
  assert.equal((comp.raw as { kind?: string }).kind, "sold-aggregate");
  assert.equal((comp.raw as { tier?: string }).tier, "PSA_10");
});

test("RAW can use PokeTrace Cardmarket baselines for UK-relevant pricing", () => {
  const comp = mapPokeTraceCardsToComp(
    {
      data: [
        {
          name: "Gengar",
          cardNumber: "TG06/TG30",
          set: { name: "Lost Origin Trainer Gallery" },
          market: "EU",
          currency: "EUR",
          prices: {
            cardmarket: {
              NEAR_MINT: { avg: 44, low: 38, high: 51, saleCount: 31, avg30d: 40 },
            },
            tcgplayer: {
              NEAR_MINT: { avg: 65, low: 58, high: 72, saleCount: 42 },
            },
          },
          lastUpdated: "2026-06-20T10:00:00Z",
        },
      ],
    },
    { source: "poketrace", card: { name: "Gengar", setName: "Lost Origin", number: "TG06/TG30" }, grade: "RAW", windowDays: 90 },
  );

  assert.equal(comp.medianPence, eurToPence(44));
  assert.equal(comp.sampleSize, 31);
  assert.equal((comp.raw as { priceSource?: string }).priceSource, "cardmarket");
  assert.equal((comp.raw as { market?: string }).market, "EU");
  const signals = (comp.raw as { signals?: Array<{ priceSource: string; medianPence: number; sampleSize: number }> }).signals ?? [];
  assert.deepEqual(
    signals.map((signal) => signal.priceSource),
    ["cardmarket", "tcgplayer"],
  );
  assert.equal(signals[0]?.medianPence, eurToPence(44));
  assert.equal(signals[1]?.sampleSize, 42);
});

test("PokeTrace search variants strip known promo prefixes for lookup", () => {
  const variants = new Set(buildPokeTraceSearchVariants({ name: "Snivy", setName: "MEP", number: "MEP049" }));
  assert.equal(variants.has("Snivy 049"), true);
  assert.equal(variants.has("Snivy 79"), false);
  assert.equal(variants.has("Snivy MEP049"), true);
  assert.equal(variants.has("Snivy 49"), true);
  assert.equal(variants.has("Snivy"), true);

  assert.equal(variants.size >= 3, true);
});

test("PokeTrace chooses the matching promo card from multiple results", () => {
  const comp = mapPokeTraceCardsToComp(
    {
      data: [
        {
          name: "Snivy",
          cardNumber: "001/012",
          set: { name: "McDonald's Promos 2011" },
          market: "US",
          currency: "USD",
          prices: { tcgplayer: { NEAR_MINT: { avg: 2, saleCount: 10 } } },
        },
        {
          name: "Snivy - 049",
          cardNumber: "049",
          set: { name: "ME: Mega Evolution Promo" },
          market: "US",
          currency: "USD",
          prices: { tcgplayer: { NEAR_MINT: { avg: 19.38, saleCount: 274 } } },
          lastUpdated: "2026-06-23T00:00:00Z",
        },
      ],
    },
    {
      source: "poketrace",
      card: { name: "Snivy", setName: "Mega Evolution Promos", number: "MEP049" },
      grade: "RAW",
      windowDays: 90,
    },
  );

  assert.equal(comp.sampleSize, 274);
  assert.equal(comp.medianPence, usdToPence(19.38));
  assert.equal(comp.card.name, "Snivy");
  assert.equal(comp.card.setName, "Mega Evolution Promos");
  assert.equal(comp.card.number, "MEP049");
  assert.deepEqual((comp.raw as { providerCard?: unknown }).providerCard, {
    name: "Snivy - 049",
    setName: "ME: Mega Evolution Promo",
    number: "049",
    game: "POKEMON",
    language: "EN",
  });
});

test("PokeTrace matches when provider set metadata is missing and set context is present", () => {
  const comp = mapPokeTraceCardsToComp(
    {
      data: [
        {
          name: "Umbreon",
          cardNumber: "94/203",
          currency: "USD",
          prices: {
            tcgplayer: {
              NEAR_MINT: { avg: 30, saleCount: 11 },
            },
          },
        },
      ],
    },
    {
      source: "poketrace",
      card: { name: "Umbreon", setName: "Evolving Skies", number: "94/203" },
      grade: "RAW",
      windowDays: 90,
    },
  );

  assert.equal(comp.sampleSize, 11);
  assert.equal(comp.medianPence, usdToPence(30));
});

test("PokeTrace matches long set aliases when provider set text is abbreviated", () => {
  const comp = mapPokeTraceCardsToComp(
    {
      data: [
        {
          name: "Victini",
          cardNumber: "SVP208",
          set: { name: "Black Star Promos" },
          market: "US",
          currency: "USD",
          prices: {
            tcgplayer: {
              NEAR_MINT: { avg: 34, saleCount: 16 },
            },
          },
        },
      ],
    },
    {
      source: "poketrace",
      card: { name: "Victini", setName: "Scarlet & Violet Black Star Promos", number: "SVP208" },
      grade: "RAW",
      windowDays: 90,
    },
  );

  assert.equal(comp.sampleSize, 16);
  assert.equal(comp.medianPence, usdToPence(34));
  assert.equal(comp.card.setName, "Scarlet & Violet Black Star Promos");
});

test("PokeTrace rejects wrong-set cards for unavailable promo sets", () => {
  const comp = mapPokeTraceCardsToComp(
    {
      data: [
        {
          name: "Snivy",
          cardNumber: "1",
          set: { name: "Black & White" },
          market: "US",
          currency: "USD",
          prices: { tcgplayer: { NEAR_MINT: { avg: 1.5, saleCount: 20 } } },
        },
      ],
    },
    {
      source: "poketrace",
      card: { name: "Snivy", setName: "MEP", number: "MEP049" },
      grade: "RAW",
      windowDays: 90,
    },
  );

  assert.equal(comp.sampleSize, 0);
  assert.match((comp.raw as { reason?: string }).reason ?? "", /card match/);
});

test("PokeTrace rejects same-number cards from the wrong explicit set", () => {
  const comp = mapPokeTraceCardsToComp(
    {
      data: [
        {
          name: "Charizard",
          cardNumber: "4/102",
          set: { name: "Celebrations: Classic Collection" },
          market: "US",
          currency: "USD",
          prices: { tcgplayer: { NEAR_MINT: { avg: 180, saleCount: 400 } } },
        },
      ],
    },
    {
      source: "poketrace",
      card: { name: "Charizard", setName: "Base", number: "4/102" },
      grade: "RAW",
      windowDays: 90,
    },
  );

  assert.equal(comp.sampleSize, 0);
  assert.match((comp.raw as { reason?: string }).reason ?? "", /card match/);
});

test("PokeTrace rejects generic cards for first-edition requests", () => {
  const comp = mapPokeTraceCardsToComp(
    {
      data: [
        {
          name: "Charizard",
          cardNumber: "4/102",
          set: { name: "Base" },
          market: "EU",
          currency: "EUR",
          prices: { cardmarket: { NEAR_MINT: { avg: 500, saleCount: 20 } } },
        },
      ],
    },
    {
      source: "poketrace",
      card: { name: "Charizard 1st Edition", setName: "Base", number: "4/102" },
      grade: "RAW",
      windowDays: 90,
    },
  );

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
  assert.match((comp.raw as { reason?: string }).reason ?? "", /card match/);
});

test("PokeTrace allows explicitly labelled first-edition provider matches", () => {
  const comp = mapPokeTraceCardsToComp(
    {
      data: [
        {
          name: "Charizard 1st Edition",
          cardNumber: "4/102",
          set: { name: "Base" },
          market: "EU",
          currency: "EUR",
          prices: { cardmarket: { NEAR_MINT: { avg: 500, saleCount: 20 } } },
        },
      ],
    },
    {
      source: "poketrace",
      card: { name: "Charizard 1st Edition", setName: "Base", number: "4/102" },
      grade: "RAW",
      windowDays: 90,
    },
  );

  assert.equal(comp.sampleSize, 20);
  assert.equal(comp.medianPence, eurToPence(500));
});

test("PokeTraceSource tries EU first, then falls back to US", async () => {
  const requestedMarkets: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const market = new URL(String(url)).searchParams.get("market") ?? "";
    requestedMarkets.push(market);
    if (market === "EU") return Response.json({ data: [] });
    return Response.json(fixture);
  }) as typeof fetch;
  const source = new PokeTraceSource("secret", fetchImpl, 5, 0);
  const comp = await source.lookup(card, { grade: "RAW" });

  assert.deepEqual(requestedMarkets, ["EU", "US"]);
  assert.equal(comp.sampleSize, 73);
  assert.equal((comp.raw as { market?: string }).market, "US");
});

test("PokeTraceSource stops after a usable EU market comp", async () => {
  const requestedMarkets: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const market = new URL(String(url)).searchParams.get("market") ?? "";
    requestedMarkets.push(market);
    return Response.json({
      data: [
        {
          name: "Gengar",
          cardNumber: "TG06/TG30",
          set: { name: "Lost Origin Trainer Gallery" },
          market,
          currency: "EUR",
          prices: {
            cardmarket_unsold: {
              NEAR_MINT: { avg: 44, low: 38, high: 51, saleCount: 31 },
            },
          },
          lastUpdated: "2026-06-20T10:00:00Z",
        },
      ],
    });
  }) as typeof fetch;
  const source = new PokeTraceSource("secret", fetchImpl, 5);
  const comp = await source.lookup({ name: "Gengar", setName: "Lost Origin", number: "TG06/TG30" }, { grade: "RAW" });

  assert.deepEqual(requestedMarkets, ["EU"]);
  assert.equal(comp.medianPence, eurToPence(44));
  assert.equal((comp.raw as { priceSource?: string }).priceSource, "cardmarket");
});

test("PokeTraceSource degrades without keys or failed fetches", async () => {
  const offline = new PokeTraceSource(undefined);
  assert.equal((await offline.lookup(card, { grade: "RAW" })).sampleSize, 0);

  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>)["X-API-Key"], "secret");
    assert.ok(init?.signal, "live requests should carry a timeout signal");
    throw new Error("network timeout");
  }) as typeof fetch;
  const live = new PokeTraceSource("secret", fetchImpl, 5, 0);
  const comp = await live.lookup(card, { grade: "RAW" });

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
  assert.match((comp.raw as { reason?: string }).reason ?? "", /failed|no response/);
});

test("free tier: spaces the fallback US request to clear the 1-req/2s burst window", async () => {
  const callTimes: number[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    callTimes.push(Date.now());
    const market = new URL(String(url)).searchParams.get("market") ?? "";
    if (market === "EU") return Response.json({ data: [] });
    return Response.json(freeTierFixture);
  }) as typeof fetch;
  // 40ms spacing keeps the test fast while still proving the gap is applied.
  const source = new PokeTraceSource("secret", fetchImpl, 5, 40);
  const comp = await source.lookup(
    { name: "Umbreon VMAX", setName: "Evolving Skies", number: "215/203" },
    { grade: "RAW" },
  );

  assert.equal(callTimes.length, 2);
  assert.ok(callTimes[1]! - callTimes[0]! >= 35, "US fallback should be spaced after EU");
  assert.equal(comp.medianPence > 0, true);
});

test("shared throttle spaces separate source instances for rapid app lookups", async () => {
  resetPokeTraceSharedThrottleForTests();
  const callTimes: number[] = [];
  const fetchImpl = (async () => {
    callTimes.push(Date.now());
    return Response.json(fixture);
  }) as typeof fetch;
  const first = new PokeTraceSource("secret", fetchImpl, 5, 35, true);
  const second = new PokeTraceSource("secret", fetchImpl, 5, 35, true);

  await Promise.all([first.lookup(card, { grade: "RAW" }), second.lookup(card, { grade: "RAW" })]);

  assert.equal(callTimes.length, 2);
  assert.ok(callTimes[1]! - callTimes[0]! >= 30, "separate app lookups should share the PokeTrace burst guard");
  resetPokeTraceSharedThrottleForTests();
});

test("free tier (US only): RAW resolves to the US TCGPlayer baseline", () => {
  const freeCard: CardRef = { name: "Umbreon VMAX", setName: "Evolving Skies", number: "215/203" };
  const comp = mapPokeTraceCardsToComp(freeTierFixture, {
    source: "poketrace",
    card: freeCard,
    grade: "RAW",
    windowDays: 90,
  });

  // No Cardmarket on free tier, so the stable US TCGPlayer near-mint baseline is used.
  assert.equal(comp.medianPence, usdToPence(505));
  assert.equal(comp.sampleSize, 88);
  assert.equal((comp.raw as { priceSource?: string }).priceSource, "tcgplayer");
  assert.equal((comp.raw as { kind?: string }).kind, "market-baseline");
  assert.equal((comp.raw as { market?: string }).market, "US");
});

test("free tier: graded lookups degrade to empty (graded tiers are Pro-only)", () => {
  const freeCard: CardRef = { name: "Umbreon VMAX", setName: "Evolving Skies", number: "215/203" };
  const comp = mapPokeTraceCardsToComp(freeTierFixture, {
    source: "poketrace",
    card: freeCard,
    grade: "PSA_10",
    windowDays: 90,
  });

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
  assert.match((comp.raw as { reason?: string }).reason ?? "", /price tier/);
});

test("free tier: EU market request comes back empty, source falls back to US", async () => {
  const requestedMarkets: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const market = new URL(String(url)).searchParams.get("market") ?? "";
    requestedMarkets.push(market);
    // Free tier has no EU/Cardmarket access — emulate an empty EU response.
    if (market === "EU") return Response.json({ data: [] });
    return Response.json(freeTierFixture);
  }) as typeof fetch;
  const source = new PokeTraceSource("secret", fetchImpl, 5, 0);
  const comp = await source.lookup(
    { name: "Umbreon VMAX", setName: "Evolving Skies", number: "215/203" },
    { grade: "RAW" },
  );

  assert.deepEqual(requestedMarkets, ["EU", "US"]);
  assert.equal(comp.medianPence, usdToPence(505));
  assert.equal((comp.raw as { market?: string }).market, "US");
});

test("malformed or unsupported payloads return empty comps", () => {
  const nullComp = mapPokeTraceCardsToComp(null, ctx("RAW"));
  const emptyComp = mapPokeTraceCardsToComp({ data: [] }, ctx("RAW"));
  const unsupportedComp = mapPokeTraceCardsToComp(fixture, ctx("CGC_10"));

  assert.equal(nullComp.sampleSize, 0);
  assert.equal(emptyComp.sampleSize, 0);
  assert.equal(unsupportedComp.sampleSize, 0);
  assert.match((emptyComp.raw as { reason?: string }).reason ?? "", /card match/);
  assert.match((unsupportedComp.raw as { reason?: string }).reason ?? "", /price tier/);
});
