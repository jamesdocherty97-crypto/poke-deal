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

test("catalog market evidence without a provider date stays explicitly undated", () => {
  const undated = {
    ...catalogCard,
    priceSignals: catalogCard.priceSignals.map(({ updatedAt: _updatedAt, ...signal }) => signal),
  };

  const comp = mapCatalogCardToMarketComp(undated, {
    source: "pokemon-tcg-market",
    card: inputCard,
    grade: "RAW",
    windowDays: 30,
  });

  assert.equal(comp.asOf, "unknown");
});

test("PokemonTcgMarketSource prefers first-edition catalog prices when requested", async () => {
  const catalog: CatalogSource = {
    name: "fake-catalog",
    live: true,
    async resolve() {
      return {
        ...catalogCard,
        name: "Hitmontop",
        setName: "Neo Genesis",
        number: "3/111",
        tcgApiId: "neo1-3",
        priceSignals: [
          {
            source: "tcgplayer" as const,
            label: "TCGPlayer Normal Market",
            pricePence: 1800,
            originalAmount: 22,
            originalCurrency: "USD" as const,
            kind: "market",
            variant: "normal",
            updatedAt: "2026/06/20",
          },
          {
            source: "tcgplayer" as const,
            label: "TCGPlayer 1st Edition Normal Market",
            pricePence: 4200,
            originalAmount: 52,
            originalCurrency: "USD" as const,
            kind: "market",
            variant: "1stEditionNormal",
            updatedAt: "2026/06/20",
          },
        ],
      };
    },
  };
  const source = new PokemonTcgMarketSource(catalog);
  const comp = await source.lookup(
    { name: "Hitmontop 1st Edition", setName: "Neo Genesis", number: "3/111" },
    { grade: "RAW" },
  );

  assert.equal(comp.medianPence, 4200);
  assert.equal((comp.raw as { chosenSignal?: { variant?: string } }).chosenSignal?.variant, "1stEditionNormal");
});

test("PokemonTcgMarketSource uses reverse-holo signals when requested", async () => {
  const catalog: CatalogSource = {
    name: "fake-catalog",
    live: true,
    async resolve() {
      return {
        ...catalogCard,
        name: "Gengar",
        setName: "Lost Origin",
        number: "TG06/TG30",
        tcgApiId: "lot-6",
        priceSignals: [
          {
            source: "tcgplayer" as const,
            label: "TCGPlayer Holofoil Market",
            pricePence: 1200,
            originalAmount: 15,
            originalCurrency: "USD" as const,
            kind: "market",
            variant: "holofoil",
            updatedAt: "2026/06/20",
          },
          {
            source: "tcgplayer" as const,
            label: "TCGPlayer Reverse Holofoil Market",
            pricePence: 2500,
            originalAmount: 31,
            originalCurrency: "USD" as const,
            kind: "market",
            variant: "reverseHolofoil",
            updatedAt: "2026/06/20",
          },
        ],
      };
    },
  };
  const source = new PokemonTcgMarketSource(catalog);
  const comp = await source.lookup(
    { name: "Gengar Reverse Holo", setName: "Lost Origin", number: "TG06/TG30" },
    { grade: "RAW" },
  );

  assert.equal(comp.medianPence, 2500);
  assert.equal((comp.raw as { chosenSignal?: { variant?: string } }).chosenSignal?.variant, "reverseHolofoil");
});

test("PokemonTcgMarketSource uses normal signals when requested", async () => {
  const catalog: CatalogSource = {
    name: "fake-catalog",
    live: true,
    async resolve() {
      return {
        ...catalogCard,
        name: "Gengar",
        setName: "Lost Origin",
        number: "TG06/TG30",
        tcgApiId: "lot-6",
        priceSignals: [
          {
            source: "tcgplayer" as const,
            label: "TCGPlayer Holofoil Market",
            pricePence: 1200,
            originalAmount: 15,
            originalCurrency: "USD" as const,
            kind: "market",
            variant: "holofoil",
            updatedAt: "2026/06/20",
          },
          {
            source: "tcgplayer" as const,
            label: "TCGPlayer Reverse Holofoil Market",
            pricePence: 2500,
            originalAmount: 31,
            originalCurrency: "USD" as const,
            kind: "market",
            variant: "reverseHolofoil",
            updatedAt: "2026/06/20",
          },
          {
            source: "tcgplayer" as const,
            label: "TCGPlayer Normal Market",
            pricePence: 900,
            originalAmount: 11,
            originalCurrency: "USD" as const,
            kind: "market",
            variant: "normal",
            updatedAt: "2026/06/20",
          },
        ],
      };
    },
  };
  const source = new PokemonTcgMarketSource(catalog);
  const comp = await source.lookup(
    { name: "Gengar Normal", setName: "Lost Origin", number: "TG06/TG30" },
    { grade: "RAW" },
  );

  assert.equal(comp.medianPence, 900);
  assert.equal((comp.raw as { chosenSignal?: { variant?: string } }).chosenSignal?.variant, "normal");
});

test("PokemonTcgMarketSource computes trend from cardmarket averages", async () => {
  const catalog: CatalogSource = {
    name: "fake-catalog",
    live: true,
    async resolve() {
      return {
        ...catalogCard,
        name: "Pikachu",
        setName: "Base Set",
        priceSignals: [
          {
            source: "cardmarket" as const,
            label: "Cardmarket Avg30",
            pricePence: 1000,
            originalAmount: 10.5,
            originalCurrency: "EUR" as const,
            kind: "avg30",
            updatedAt: "2026/06/20",
          },
          {
            source: "cardmarket" as const,
            label: "Cardmarket Avg7",
            pricePence: 1120,
            originalAmount: 11.5,
            originalCurrency: "EUR" as const,
            kind: "avg7",
            updatedAt: "2026/06/20",
          },
        ],
      };
    },
  };
  const source = new PokemonTcgMarketSource(catalog);
  const comp = await source.lookup({ name: "Pikachu", setName: "Base" }, { grade: "RAW" });

  assert.equal(comp.trendPct, 12);
});

test("PokemonTcgMarketSource strips vintage Cardmarket trendPrice spikes from evidence", async () => {
  const catalog: CatalogSource = {
    name: "fake-catalog",
    live: true,
    async resolve() {
      return {
        ...catalogCard,
        name: "Charizard",
        setName: "Base",
        setCode: "base1",
        number: "4/102",
        tcgApiId: "base1-4",
        priceSignals: [
          {
            source: "cardmarket" as const,
            label: "Cardmarket Trend Price",
            pricePence: 357658,
            originalAmount: 4184.6,
            originalCurrency: "EUR" as const,
            kind: "trendPrice",
            updatedAt: "2026/07/01",
          },
          {
            source: "tcgplayer" as const,
            label: "TCGPlayer Holofoil market",
            pricePence: 54652,
            originalAmount: 694.08,
            originalCurrency: "USD" as const,
            kind: "market",
            variant: "holofoil",
            updatedAt: "2026/07/02",
          },
        ],
      };
    },
  };
  const source = new PokemonTcgMarketSource(catalog);
  const comp = await source.lookup({ name: "Charizard", setName: "Base", number: "4/102" }, { grade: "RAW" });
  const raw = comp.raw as { chosenSignal?: { source?: string; kind?: string }; signals?: Array<{ kind?: string }> };

  assert.equal(comp.medianPence, 54652);
  assert.equal(raw.chosenSignal?.source, "tcgplayer");
  assert.equal(raw.chosenSignal?.kind, "market");
  assert.equal(raw.signals?.some((signal) => signal.kind === "trendPrice"), false);
});

test("PokemonTcgMarketSource refuses regular market prices for first-edition requests", async () => {
  const catalog: CatalogSource = {
    name: "fake-catalog",
    live: true,
    async resolve() {
      return {
        ...catalogCard,
        name: "Hitmontop",
        setName: "Neo Genesis",
        number: "3/111",
        tcgApiId: "neo1-3",
        priceSignals: [
          {
            source: "tcgplayer" as const,
            label: "TCGPlayer Normal Market",
            pricePence: 1800,
            originalAmount: 22,
            originalCurrency: "USD" as const,
            kind: "market",
            variant: "normal",
            updatedAt: "2026/06/20",
          },
        ],
      };
    },
  };
  const source = new PokemonTcgMarketSource(catalog);
  const comp = await source.lookup(
    { name: "Hitmontop 1st Edition", setName: "Neo Genesis", number: "3/111" },
    { grade: "RAW" },
  );

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
  assert.equal((comp.raw as { reason?: string }).reason, "no first edition catalog market price");
});

test("catalog market never substitutes holo for an explicit reverse-holo request", () => {
  const comp = mapCatalogCardToMarketComp(
    { ...catalogCard, priceSignals: [catalogCard.priceSignals[0]!] },
    { source: "catalog-market", card: { ...inputCard, finish: "REVERSE_HOLO" }, grade: "RAW", windowDays: 90 },
  );
  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
});

test("catalog market refuses generic prices for unsupported shadowless identity", () => {
  const comp = mapCatalogCardToMarketComp(
    catalogCard,
    { source: "catalog-market", card: { name: "Charizard", setName: "Base", number: "4/102", edition: "SHADOWLESS", finish: "HOLO" }, grade: "RAW", windowDays: 90 },
  );
  assert.equal(comp.sampleSize, 0);
});

test("catalog market requires both first-edition and requested finish", () => {
  const comp = mapCatalogCardToMarketComp(
    {
      ...catalogCard,
      name: "Hitmontop",
      setName: "Neo Genesis",
      number: "3/111",
      priceSignals: [
        { ...catalogCard.priceSignals[0]!, variant: "1stEditionNormal", pricePence: 1800 },
        { ...catalogCard.priceSignals[0]!, variant: "1stEditionHolofoil", pricePence: 5200 },
      ],
    },
    { source: "catalog-market", card: { name: "Hitmontop", setName: "Neo Genesis", number: "3/111", edition: "FIRST_EDITION", finish: "HOLO" }, grade: "RAW", windowDays: 90 },
  );
  assert.equal(comp.medianPence, 5200);
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
