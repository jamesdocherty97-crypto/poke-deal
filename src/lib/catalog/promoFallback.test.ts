import assert from "node:assert/strict";
import test from "node:test";

import { buildPromoCatalogFallback } from "./promoFallback.js";

test("buildPromoCatalogFallback attaches exact ScryDex artwork for modern promos", () => {
  const card = buildPromoCatalogFallback({
    name: "Alakazam",
    setName: "Mega Evolution Promos",
    number: "MEP079",
    game: "POKEMON",
    language: "EN",
  });

  assert.equal(card?.name, "Alakazam");
  assert.equal(card?.number, "MEP079");
  assert.equal(card?.tcgApiId, "mep-79");
  assert.equal(card?.imageUrl, "https://images.scrydex.com/pokemon/mep-79/large");
});
