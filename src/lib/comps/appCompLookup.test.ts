import test from "node:test";
import assert from "node:assert/strict";
import { resolveCatalogCard } from "./appCompLookup.js";
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
