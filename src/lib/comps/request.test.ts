import assert from "node:assert/strict";
import test from "node:test";

import { readCompLookupRequest } from "./request.js";

test("readCompLookupRequest accepts setName alias used by smoke tools", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    name: "Gengar",
    setName: "Lost Origin Trainer Gallery",
    number: "TG06/TG30",
    grade: "RAW",
  }));

  assert.deepEqual(parsed, {
    card: {
      name: "Gengar",
      setName: "Lost Origin Trainer Gallery",
      number: "TG06/TG30",
      game: "POKEMON",
      language: "EN",
    },
    grade: "RAW",
  });
});

test("readCompLookupRequest accepts cardName alias used by smoke tools", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    cardName: "Snivy",
    setName: "Mega Evolution Promo",
    number: "MEP049",
    grade: "RAW",
  }));

  assert.deepEqual(parsed, {
    card: {
      name: "Snivy",
      setName: "Mega Evolution Promo",
      number: "MEP049",
      game: "POKEMON",
      language: "EN",
    },
    grade: "RAW",
  });
});

test("readCompLookupRequest parses one-box dealer shorthand", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    q: "Snivy MEP 049 raw £2",
  }));

  assert.deepEqual(parsed, {
    card: {
      name: "Snivy",
      setName: "Mega Evolution Promos",
      number: "MEP049",
      game: "POKEMON",
      language: "EN",
    },
    grade: "RAW",
  });
});

test("readCompLookupRequest preserves 1st Edition variant text for pricing", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    q: "Hitmontop Neo Genesis 1st Edition LP",
  }));

  assert.deepEqual(parsed, {
    card: {
      name: "Hitmontop 1st Edition",
      setName: "Neo Genesis",
      number: undefined,
      game: "POKEMON",
      language: "EN",
    },
    grade: "RAW",
  });
});

test("readCompLookupRequest normalizes typed slab grades", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    name: "Gengar",
    set: "Lost Origin Trainer Gallery",
    number: "TG06",
    grade: "ACE 10",
  }));

  assert.equal("grade" in parsed ? parsed.grade : null, "ACE_10");
});

test("readCompLookupRequest preserves canonical URL grade values", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    name: "Umbreon VMAX",
    grade: "PSA_10",
  }));

  assert.equal("grade" in parsed ? parsed.grade : null, "PSA_10");
});

test("readCompLookupRequest requires a card name", () => {
  assert.deepEqual(readCompLookupRequest(new URLSearchParams()), { error: "name is required" });
});
