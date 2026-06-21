import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPokemonTcgSearchQuery,
  mapPokemonTcgCard,
  normalizeCollectorNumber,
  PokemonTcgApiCatalogSource,
} from "./pokemonTcgApi.js";

test("buildPokemonTcgSearchQuery uses API collector number shape", () => {
  assert.equal(
    buildPokemonTcgSearchQuery({
      name: "Charizard ex",
      setName: "151",
      number: "199/165",
    }),
    'name:"Charizard ex" number:"199" set.name:"151"',
  );
});

test("normalizeCollectorNumber keeps plain and split collector numbers useful for search", () => {
  assert.equal(normalizeCollectorNumber("199/165"), "199");
  assert.equal(normalizeCollectorNumber("TG05/TG30"), "TG05");
  assert.equal(normalizeCollectorNumber("42"), "42");
});

test("mapPokemonTcgCard maps catalog fields and reconstructs full collector number", () => {
  const card = mapPokemonTcgCard({
    id: "sv3pt5-199",
    name: "Charizard ex",
    number: "199",
    rarity: "Special Illustration Rare",
    images: {
      small: "https://images.pokemontcg.io/sv3pt5/199.png",
      large: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
    },
    set: {
      id: "sv3pt5",
      name: "Scarlet & Violet 151",
      printedTotal: 165,
    },
  });

  assert.equal(card?.tcgApiId, "sv3pt5-199");
  assert.equal(card?.setCode, "sv3pt5");
  assert.equal(card?.number, "199/165");
  assert.equal(card?.imageUrl, "https://images.pokemontcg.io/sv3pt5/199_hires.png");
});

test("PokemonTcgApiCatalogSource searches cards and sends API key header when present", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: URL, init?: RequestInit) => {
    calls.push({ url: url.toString(), headers: init?.headers as Record<string, string> });
    return {
      ok: true,
      async json() {
        return {
          data: [
            {
              id: "sv3pt5-006",
              name: "Charizard ex",
              number: "006",
              set: { id: "sv3pt5", name: "Scarlet & Violet 151", printedTotal: 165 },
            },
            {
              id: "sv3pt5-199",
              name: "Charizard ex",
              number: "199",
              images: { small: "small.png" },
              set: { id: "sv3pt5", name: "Scarlet & Violet 151", printedTotal: 165 },
            },
          ],
        };
      },
    } as Response;
  }) as typeof fetch;

  const source = new PokemonTcgApiCatalogSource("secret", fetchImpl, "https://api.example.test/v2");
  const card = await source.resolve({ name: "Charizard ex", setName: "151", number: "199/165" });

  assert.equal(card?.tcgApiId, "sv3pt5-199");
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.url.startsWith("https://api.example.test/v2/cards?"));
  assert.equal(
    new URL(calls[0]?.url ?? "").searchParams.get("q"),
    'name:"Charizard ex" number:"199" set.name:"151"',
  );
  assert.equal(calls[0]?.headers["X-Api-Key"], "secret");
});

test("PokemonTcgApiCatalogSource fetches by tcgApiId when supplied", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: URL) => {
    calls.push(url.toString());
    return {
      ok: true,
      async json() {
        return {
          data: {
            id: "sv3pt5-199",
            name: "Charizard ex",
            number: "199",
            set: { id: "sv3pt5", name: "Scarlet & Violet 151", printedTotal: 165 },
          },
        };
      },
    } as Response;
  }) as typeof fetch;

  const source = new PokemonTcgApiCatalogSource(undefined, fetchImpl, "https://api.example.test/v2");
  const card = await source.resolve({ name: "Charizard ex", tcgApiId: "sv3pt5-199" });

  assert.equal(card?.number, "199/165");
  assert.equal(calls[0], "https://api.example.test/v2/cards/sv3pt5-199?select=id%2Cname%2Cnumber%2Crarity%2Cimages%2Cset");
});
