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
});

test("malformed or unsupported payloads return empty comps", () => {
  assert.equal(mapPokeTraceCardsToComp(null, ctx("RAW")).sampleSize, 0);
  assert.equal(mapPokeTraceCardsToComp({ data: [] }, ctx("RAW")).sampleSize, 0);
  assert.equal(mapPokeTraceCardsToComp(fixture, ctx("CGC_10")).sampleSize, 0);
});
