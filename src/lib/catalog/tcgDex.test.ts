import assert from "node:assert/strict";
import test from "node:test";

import { mapTcgDexCard, mapTcgDexSetCards, TcgDexCatalogSource } from "./tcgDex.js";

test("mapTcgDexCard maps physical promo identity and assets", () => {
  const card = mapTcgDexCard({
    id: "svp-208",
    localId: "208",
    name: "Victini",
    image: "https://assets.tcgdex.net/en/sv/svp/208",
    rarity: "None",
    set: {
      id: "svp",
      name: "SVP Black Star Promos",
      logo: "https://assets.tcgdex.net/en/sv/svp/logo",
      symbol: "https://assets.tcgdex.net/univ/sv/svp/symbol",
    },
  });

  assert.equal(card?.name, "Victini");
  assert.equal(card?.setName, "Scarlet & Violet Black Star Promos");
  assert.equal(card?.setCode, "svp");
  assert.equal(card?.number, "SVP208");
  assert.equal(card?.tcgDexId, "svp-208");
  assert.equal(card?.imageUrl, "https://assets.tcgdex.net/en/sv/svp/208/high.webp");
  assert.equal(card?.setLogoUrl, "https://assets.tcgdex.net/en/sv/svp/logo.webp");
});

test("TcgDexCatalogSource resolves by set and local promo number before name search", async () => {
  const requested: string[] = [];
  const fetchImpl = async (input: URL | RequestInfo) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/sets/svp/208")) {
      return Response.json({
        id: "svp-208",
        localId: "208",
        name: "Victini",
        set: { id: "svp", name: "SVP Black Star Promos" },
      });
    }
    return Response.json({});
  };

  const source = new TcgDexCatalogSource(fetchImpl as typeof fetch, "https://api.example.test/v2/en");
  const card = await source.resolve({ name: "Victini", setName: "SV Promos", number: "SVP208" });

  assert.equal(card?.tcgDexId, "svp-208");
  assert.equal(card?.number, "SVP208");
  assert.equal(card?.imageUrl, "https://images.scrydex.com/pokemon/svp-208/large");
  assert.deepEqual(requested, ["https://api.example.test/v2/en/sets/svp/208"]);
});

test("mapTcgDexSetCards skips TCG Pocket digital-only sets", () => {
  const cards = mapTcgDexSetCards({
    id: "B1",
    name: "Mega Rising",
    serie: { id: "tcgp", name: "Pokémon TCG Pocket" },
    cards: [{ id: "B1-001", localId: "001", name: "Pinsir" }],
  });

  assert.deepEqual(cards, []);
});
