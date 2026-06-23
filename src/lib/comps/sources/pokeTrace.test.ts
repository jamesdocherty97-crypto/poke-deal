import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gradeToPokeTraceTier, mapPokeTraceCardsToComp, PokeTraceSource } from "./pokeTrace.js";
import type { CardRef } from "../../domain/types.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/poketrace-cards.json", import.meta.url)), "utf8"),
);

const card: CardRef = { name: "Charizard ex", setName: "151", number: "199/165" };
const ctx = (grade: any) => ({ source: "poketrace", card, grade, windowDays: 90 });
const usdToPence = (usd: number) => Math.round((usd / 1.27) * 100);
const eurToPence = (eur: number) => Math.round((eur / 1.17) * 100);

test("gradeToPokeTraceTier maps raw and slab grades to PokeTrace tiers", () => {
  assert.equal(gradeToPokeTraceTier("RAW"), "NEAR_MINT");
  assert.equal(gradeToPokeTraceTier("PSA_10"), "PSA_10");
  assert.equal(gradeToPokeTraceTier("BGS_9_5"), "BGS_9_5");
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
});

test("PokeTraceSource tries EU first, then falls back to US", async () => {
  const requestedMarkets: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const market = new URL(String(url)).searchParams.get("market") ?? "";
    requestedMarkets.push(market);
    if (market === "EU") return Response.json({ data: [] });
    return Response.json(fixture);
  }) as typeof fetch;
  const source = new PokeTraceSource("secret", fetchImpl, 5);
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
  const live = new PokeTraceSource("secret", fetchImpl, 5);
  const comp = await live.lookup(card, { grade: "RAW" });

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
  assert.match((comp.raw as { reason?: string }).reason ?? "", /failed|no response/);
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
