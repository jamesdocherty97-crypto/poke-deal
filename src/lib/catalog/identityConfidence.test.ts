import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCatalogIdentity } from "./identityConfidence.js";
import type { CatalogCard } from "./types.js";

const card: CatalogCard = {
  game: "POKEMON",
  language: "EN",
  name: "Hitmontop",
  setName: "Neo Genesis",
  number: "3/111",
  tcgApiId: "neo1-3",
  tcgDexId: "neo1-3",
  edition: "FIRST_EDITION",
  finish: "HOLO",
};

test("exact multi-provider print identity is high confidence and auto-selectable", () => {
  const result = evaluateCatalogIdentity({
    name: "Hitmontop 1st Edition Holo",
    setName: "Neo Genesis",
    number: "3/111",
    language: "EN",
    edition: "FIRST_EDITION",
    finish: "HOLO",
  }, card);

  assert.equal(result.level, "high");
  assert.equal(result.score, 100);
  assert.equal(result.autoSelectable, true);
  assert.deepEqual(result.conflicts, []);
});

test("language and edition conflicts force a manual identity check", () => {
  const result = evaluateCatalogIdentity({
    name: "Hitmontop",
    setName: "Neo Genesis",
    number: "3/111",
    language: "JP",
    edition: "SHADOWLESS",
  }, card);

  assert.equal(result.level, "low");
  assert.equal(result.autoSelectable, false);
  assert.match(result.conflicts.join(" "), /language conflict/);
  assert.match(result.conflicts.join(" "), /edition conflict/);
});

test("unconfirmed explicit print identity cannot silently auto-select", () => {
  const result = evaluateCatalogIdentity({
    name: "Charizard Shadowless",
    setName: "Base",
    number: "4/102",
    language: "EN",
    edition: "SHADOWLESS",
  }, { game: "POKEMON", language: "EN", name: "Charizard", setName: "Base", number: "4/102", tcgApiId: "base1-4" });

  assert.equal(result.level, "low");
  assert.equal(result.autoSelectable, false);
  assert.match(result.conflicts.join(" "), /not provider-confirmed/);
});

test("incomplete catalog identity remains non-actionable", () => {
  const result = evaluateCatalogIdentity({ name: "Umbreon", language: "EN" }, {
    game: "POKEMON",
    language: "EN",
    name: "Umbreon",
    setName: "Unknown",
  });
  assert.equal(result.level, "low");
  assert.equal(result.autoSelectable, false);
});
