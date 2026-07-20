import assert from "node:assert/strict";
import test from "node:test";

import { groupDuplicateCardIdentities } from "./duplicateCards.js";

const base = {
  game: "POKEMON",
  language: "EN",
  name: "Rayquaza VMAX",
  setName: "Evolving Skies",
  edition: null,
  finish: null,
};

test("numerator-only and printed-total provider rows form one safe identity", () => {
  const result = groupDuplicateCardIdentities([
    { ...base, id: "short", number: "218" },
    { ...base, id: "printed", number: "218/203" },
  ]);
  assert.deepEqual(result.groups.map((group) => group.map((card) => card.id)), [["printed", "short"]]);
  assert.equal(result.conflicts.length, 0);
});

test("a short number cannot bridge conflicting printed totals", () => {
  const result = groupDuplicateCardIdentities([
    { ...base, id: "short", number: "218" },
    { ...base, id: "first", number: "218/203" },
    { ...base, id: "second", number: "218/204" },
  ]);
  assert.equal(result.groups.length, 0);
  assert.equal(result.conflicts[0]?.reason, "conflicting-printed-totals");
});

test("edition, finish, and card name remain hard identity boundaries", () => {
  const result = groupDuplicateCardIdentities([
    { ...base, id: "normal", number: "218", finish: "NORMAL" },
    { ...base, id: "holo", number: "218/203", finish: "HOLO" },
    { ...base, id: "other-name", number: "218/203", name: "Rayquaza V" },
  ]);
  assert.equal(result.groups.length, 0);
  assert.equal(result.conflicts.length, 0);
});
