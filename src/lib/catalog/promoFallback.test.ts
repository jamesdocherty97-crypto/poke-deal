import assert from "node:assert/strict";
import test from "node:test";

import { buildPromoCatalogFallback } from "./promoFallback.js";

test("buildPromoCatalogFallback preserves identity without constructing an unverified image URL", () => {
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
  assert.equal(card?.imageUrl, undefined);
});
