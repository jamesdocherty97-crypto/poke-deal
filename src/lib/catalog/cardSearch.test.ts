import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCatalogCardSearchInput,
  parseCardSearchQuery,
  rankCatalogCards,
  scoreCatalogCardForSearch,
} from "./cardSearch.js";
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

test("rankCatalogCards understands collector numbers typed alongside names", () => {
  const mixed: CatalogCard[] = [
    { game: "POKEMON", language: "EN", name: "Gengar", setName: "Lost Origin", setCode: "swsh11", number: "66/196" },
    {
      game: "POKEMON",
      language: "EN",
      name: "Gengar",
      setName: "Lost Origin Trainer Gallery",
      setCode: "swsh11tg",
      number: "TG06/TG30",
    },
  ];

  assert.deepEqual(parseCardSearchQuery("Gengar TG06"), { name: "Gengar", number: "TG06" });
  assert.equal(rankCatalogCards("Gengar TG06", mixed, { setName: "Lost Origin" })[0]?.setCode, "swsh11tg");
  assert.equal(scoreCatalogCardForSearch("TG06", mixed[1]!), 1100);
});

test("normalizeCatalogCardSearchInput splits dealer shorthand into card, set and number", () => {
  assert.deepEqual(normalizeCatalogCardSearchInput("Gengar Lost Origin TG06 raw £10"), {
    query: "Gengar TG06",
    name: "Gengar",
    setName: "Lost Origin Trainer Gallery",
    number: "TG06",
  });

  assert.deepEqual(normalizeCatalogCardSearchInput("Charizard ex 151 199/165 PSA 10"), {
    query: "Charizard ex 199/165",
    name: "Charizard ex",
    setName: "151",
    number: "199/165",
  });
});

test("rankCatalogCards treats shortened prefixed subset totals as equivalent", () => {
  const gengar: CatalogCard = {
    game: "POKEMON",
    language: "EN",
    name: "Gengar",
    setName: "Lost Origin Trainer Gallery",
    setCode: "swsh11tg",
    number: "TG06/TG30",
  };

  assert.ok(scoreCatalogCardForSearch("Gengar TG06/30", gengar) > 0);
});

test("rankCatalogCards understands promo collector numbers typed alongside names", () => {
  const mixed: CatalogCard[] = [
    {
      game: "POKEMON",
      language: "EN",
      name: "Charizard VSTAR",
      setName: "SWSH Black Star Promos",
      setCode: "swshp",
      number: "SWSH262",
    },
    {
      game: "POKEMON",
      language: "EN",
      name: "Charizard VSTAR",
      setName: "Crown Zenith",
      setCode: "swsh12pt5",
      number: "18/159",
    },
  ];

  assert.deepEqual(parseCardSearchQuery("Charizard VSTAR SWSH262"), {
    name: "Charizard VSTAR",
    number: "SWSH262",
  });
  assert.equal(rankCatalogCards("Charizard VSTAR SWSH262", mixed, { setName: "SWSH Promos" })[0]?.setCode, "swshp");
});

test("rankCatalogCards matches SVP promo numbers against API-style numeric promo numbers", () => {
  const mixed: CatalogCard[] = [
    {
      game: "POKEMON",
      language: "EN",
      name: "Pikachu",
      setName: "Scarlet & Violet Black Star Promos",
      setCode: "svp",
      number: "101",
    },
    {
      game: "POKEMON",
      language: "EN",
      name: "Pikachu with Grey Felt Hat",
      setName: "Scarlet & Violet Black Star Promos",
      setCode: "svp",
      number: "85",
    },
  ];

  assert.deepEqual(parseCardSearchQuery("Pikachu with Grey Felt Hat SVP085"), {
    name: "Pikachu with Grey Felt Hat",
    number: "SVP085",
  });
  assert.equal(rankCatalogCards("Pikachu SVP085", mixed, { setName: "SV Promos" })[0]?.number, "85");
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
