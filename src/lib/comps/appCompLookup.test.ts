import test from "node:test";
import assert from "node:assert/strict";
import { catalogToCardRef, findCatalogAlternatives, resolveCatalogCard } from "./appCompLookup.js";
import type { PokemonTcgApiCatalogSource } from "../catalog/pokemonTcgApi.js";
import type { CatalogCard } from "../catalog/types.js";
import type { CardRef } from "../domain/types.js";

test("resolveCatalogCard falls back through catalogue search and refreshes the chosen card by id", async () => {
  const searchedCard: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Pikachu with Grey Felt Hat",
    setName: "Scarlet & Violet Black Star Promos",
    setCode: "svp",
    number: "SVP085",
    tcgApiId: "svp-85",
  };
  const pricedCard: CatalogCard = {
    ...searchedCard,
    imageUrl: "https://images.pokemontcg.io/svp/85_hires.png",
    priceSignals: [
      {
        source: "cardmarket",
        label: "Cardmarket Trend Price",
        pricePence: 8700,
        originalAmount: 101.79,
        originalCurrency: "EUR",
        kind: "trendPrice",
      },
    ],
  };

  const calls: string[] = [];
  const source = {
    async resolve(card: CardRef) {
      calls.push(`resolve:${card.tcgApiId ?? "freeform"}`);
      return card.tcgApiId === "svp-85" ? pricedCard : null;
    },
    async search(card: CardRef) {
      calls.push(`search:${card.name}`);
      return [searchedCard];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Pikachu with Grey Felt Hat", setName: "SV Promos", number: "SVP085" },
    source,
  );

  assert.deepEqual(calls, [
    "resolve:freeform",
    "search:Pikachu with Grey Felt Hat",
    "resolve:svp-85",
  ]);
  assert.equal(resolved?.tcgApiId, "svp-85");
  assert.equal(resolved?.priceSignals?.[0]?.pricePence, 8700);
});

test("catalogToCardRef preserves first-edition intent after catalog canonicalization", () => {
  const catalog: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Lugia",
    setName: "Neo Genesis",
    setCode: "neo1",
    number: "9/111",
    tcgApiId: "neo1-9",
  };

  const card = catalogToCardRef(catalog, { name: "Lugia 1st Edition", setName: "Neo Genesis" });

  assert.equal(card.name, "Lugia 1st Edition");
  assert.equal(card.setName, "Neo Genesis");
  assert.equal(card.number, "9/111");
  assert.equal(card.tcgApiId, "neo1-9");
});

test("resolveCatalogCard rejects same-name cards from the wrong requested set", async () => {
  const wrongSetCard: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Hitmontop",
    setName: "Neo Discovery",
    setCode: "neo2",
    number: "3/75",
    tcgApiId: "neo2-3",
  };
  const source = {
    async resolve() {
      return wrongSetCard;
    },
    async search() {
      return [wrongSetCard];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Hitmontop", setName: "Neo Genesis", number: "3/111" },
    source,
  );

  assert.equal(resolved, null);
});

test("findCatalogAlternatives returns safe wrong-set recovery candidates", async () => {
  const wrongSetCard: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Hitmontop",
    setName: "Neo Discovery",
    setCode: "neo2",
    number: "3/75",
    imageUrl: "https://images.pokemontcg.io/neo2/3_hires.png",
    tcgApiId: "neo2-3",
  };
  const wrongNameCard: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Bellossom",
    setName: "Neo Genesis",
    setCode: "neo1",
    number: "3/111",
    tcgApiId: "neo1-3",
  };
  const source = {
    async search() {
      return [wrongNameCard, wrongSetCard, wrongSetCard];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const alternatives = await findCatalogAlternatives(
    { name: "Hitmontop 1st Edition", setName: "Neo Genesis", number: "3/111" },
    source,
  );

  assert.deepEqual(alternatives, [wrongSetCard]);
});

test("resolveCatalogCard rejects same-set cards when the requested name differs", async () => {
  const wrongCard: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Bellossom",
    setName: "Neo Genesis",
    setCode: "neo1",
    number: "3/111",
    tcgApiId: "neo1-3",
  };
  const source = {
    async resolve() {
      return wrongCard;
    },
    async search() {
      return [wrongCard];
    },
  } as unknown as PokemonTcgApiCatalogSource;

  const resolved = await resolveCatalogCard(
    { name: "Hitmontop", setName: "Neo Genesis", number: "3/111" },
    source,
  );

  assert.equal(resolved, null);
});
