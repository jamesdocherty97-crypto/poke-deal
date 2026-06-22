import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCatalogCards, scoreCatalogCardForSearch } from "./cardSearch.js";
import { searchChaseCards } from "./chaseCards.js";
import type { CatalogCard } from "./types.js";

const cards: CatalogCard[] = [
  { game: "POKEMON", language: "EN", name: "Pikachu ex", setName: "Surging Sparks", setCode: "sv8", number: "238/191" },
  { game: "POKEMON", language: "EN", name: "Charizard ex", setName: "151", setCode: "sv3pt5", number: "199/165" },
  { game: "POKEMON", language: "EN", name: "Mr. Mime", setName: "Base", setCode: "base1", number: "22/102" },
];

test("rankCatalogCards tolerates card-name typos", () => {
  assert.equal(rankCatalogCards("Charzard", cards)[0]?.name, "Charizard ex");
  assert.equal(rankCatalogCards("Mr Mime", cards)[0]?.name, "Mr. Mime");
});

test("rankCatalogCards uses set context to prefer the right card", () => {
  const mixed: CatalogCard[] = [
    { game: "POKEMON", language: "EN", name: "Charizard", setName: "Base", setCode: "base1", number: "4/102" },
    { game: "POKEMON", language: "EN", name: "Charizard", setName: "Vivid Voltage", setCode: "swsh4", number: "25/185" },
  ];

  assert.equal(rankCatalogCards("Charizard", mixed, { setName: "base set" })[0]?.setName, "Base");
});

test("rankCatalogCards applies cached set aliases to card suggestion context", () => {
  const mixed: CatalogCard[] = [
    { game: "POKEMON", language: "EN", name: "Umbreon VMAX", setName: "Brilliant Stars", setCode: "swsh9", number: "TG23/TG30" },
    { game: "POKEMON", language: "EN", name: "Umbreon VMAX", setName: "Evolving Skies", setCode: "swsh7", number: "215/203" },
  ];

  assert.equal(rankCatalogCards("Umbreon VMAX", mixed, { setName: "moonbreon" })[0]?.setCode, "swsh7");
});

test("scoreCatalogCardForSearch penalizes wrong set context without hiding useful suggestions", () => {
  const score = scoreCatalogCardForSearch("Pikachu", cards[0]!, "Base");
  assert.ok(score > 0);
  assert.ok(score < scoreCatalogCardForSearch("Pikachu", cards[0]!, "Surging Sparks"));
});

test("scoreCatalogCardForSearch does not surface unrelated cards just because they have images", () => {
  assert.equal(scoreCatalogCardForSearch("Mr Mime", {
    game: "POKEMON",
    language: "EN",
    name: "Blastoise",
    setName: "Base",
    imageUrl: "https://example.test/blastoise.png",
    tcgApiId: "base1-2",
  }), 0);
});

test("searchChaseCards provides a cold-cache typo fallback", () => {
  const results = searchChaseCards("Charzard", undefined, 3);
  assert.equal(results[0]?.name, "Charizard");
  assert.equal(searchChaseCards("Mr Mime", undefined, 1)[0]?.name, "Mr. Mime");
});
