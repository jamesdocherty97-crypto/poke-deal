import { test } from "node:test";
import assert from "node:assert/strict";
import type { CatalogSource } from "../../catalog/types.js";
import type { CardRef } from "../../domain/types.js";
import { mapCatalogCardToMarketComp, PokemonTcgMarketSource } from "./pokemonTcgMarket.js";

const inputCard: CardRef = { name: "Charizard ex", setName: "151", number: "199/165" };

const catalogCard = {
  game: "POKEMON" as const,
  language: "EN" as const,
  name: "Charizard ex",
  setName: "151",
  number: "199/165",
  tcgApiId: "sv3pt5-199",
  priceSignals: [
    {
      source: "tcgplayer" as const,
      label: "TCGPlayer Holofoil Market",
      pricePence: 16200,
      originalAmount: 205.2,
      originalCurrency: "USD" as const,
      kind: "market",
      variant: "holofoil",
      updatedAt: "2026/06/20",
    },
    {
      source: "cardmarket" as const,
      label: "Cardmarket Trend Price",
      pricePence: 16987,
      originalAmount: 198.75,
      originalCurrency: "EUR" as const,
      kind: "trendPrice",
      updatedAt: "2026/06/20",
    },
  ],
};

test("PokemonTcgMarketSource returns a low-confidence RAW market baseline", async () => {
  const catalog: CatalogSource = {
    name: "fake-catalog",
    live: true,
    async resolve() {
      return catalogCard;
    },
  };
  const source = new PokemonTcgMarketSource(catalog);
  const comp = await source.lookup(inputCard, { grade: "RAW" });

  assert.equal(comp.source, "pokemon-tcg-market");
  assert.equal(comp.grade, "RAW");
  assert.equal(comp.sampleSize, 1);
  assert.equal(comp.windowDays, 30);
  assert.equal(comp.medianPence, 16987);
  assert.equal(comp.card.tcgApiId, "sv3pt5-199");
  assert.equal(comp.asOf, "2026-06-20T00:00:00.000Z");
  assert.equal((comp.raw as { chosenSignal?: { source?: string } }).chosenSignal?.source, "cardmarket");
});

test("PokemonTcgMarketSource returns empty comps for graded cards", async () => {
  const catalog: CatalogSource = {
    name: "fake-catalog",
    live: true,
    async resolve() {
      throw new Error("should not resolve graded cards");
    },
  };
  const source = new PokemonTcgMarketSource(catalog);
  const comp = await source.lookup(inputCard, { grade: "PSA_10" });

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
  assert.equal((comp.raw as { reason?: string }).reason, "catalog market prices are raw-card signals only");
});

test("PokemonTcgMarketSource rejects catalog cards from the wrong requested set", async () => {
  const catalog: CatalogSource = {
    name: "fake-catalog",
    live: true,
    async resolve() {
      return {
        ...catalogCard,
        name: "Hitmontop",
        setName: "Neo Discovery",
        setCode: "neo2",
        number: "3/75",
        tcgApiId: "neo2-3",
      };
    },
  };
  const source = new PokemonTcgMarketSource(catalog);
  const comp = await source.lookup(
    { name: "Hitmontop", setName: "Neo Genesis", number: "3/111" },
    { grade: "RAW" },
  );

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
  assert.equal((comp.raw as { reason?: string }).reason, "catalog card did not match requested set");
});

test("PokemonTcgMarketSource rejects catalog cards with the wrong requested name", async () => {
  const catalog: CatalogSource = {
    name: "fake-catalog",
    live: true,
    async resolve() {
      return {
        ...catalogCard,
        name: "Bellossom",
        setName: "Neo Genesis",
        setCode: "neo1",
        number: "3/111",
        tcgApiId: "neo1-3",
      };
    },
  };
  const source = new PokemonTcgMarketSource(catalog);
  const comp = await source.lookup(
    { name: "Hitmontop", setName: "Neo Genesis", number: "3/111" },
    { grade: "RAW" },
  );

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
  assert.equal((comp.raw as { reason?: string }).reason, "catalog card did not match requested card");
});

test("mapCatalogCardToMarketComp degrades when no market prices exist", () => {
  const comp = mapCatalogCardToMarketComp(
    { ...catalogCard, priceSignals: undefined },
    { source: "catalog-market", card: inputCard, grade: "RAW", windowDays: 90 },
  );

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
});
