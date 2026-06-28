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

test("readCompLookupRequest cleans direct cardName condition noise but keeps first edition", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    cardName: "Hitmontop - 1st Edition - LP",
    setName: "Neo Genesis",
    number: "3/111",
    grade: "RAW",
  }));

  assert.deepEqual(parsed, {
    card: {
      name: "Hitmontop 1st Edition",
      setName: "Neo Genesis",
      number: "3/111",
      game: "POKEMON",
      language: "EN",
    },
    grade: "RAW",
  });
});

test("readCompLookupRequest can recover set and number from direct cardName shorthand", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    cardName: "Snivy MEP049 raw",
    grade: "RAW",
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

test("readCompLookupRequest handles common real-world raw comp prompts", () => {
  const cases = [
    { q: "Umbreon Evolving Skies", name: "Umbreon", setName: "Evolving Skies", number: undefined },
    { q: "Blastoise XY Evolutions", name: "Blastoise", setName: "Evolutions", number: undefined },
    { q: "Galarian Gallery Pikachu", name: "Pikachu", setName: "Crown Zenith Galarian Gallery", number: undefined },
    { q: "Flittle - Paldean Fates", name: "Flittle", setName: "Paldean Fates", number: undefined },
    { q: "Full art Pawmi from Paldean Fates", name: "Pawmi", setName: "Paldean Fates", number: undefined },
    { q: "Full art Zapdos from 151", name: "Zapdos", setName: "151", number: undefined },
    { q: "SIR Lugia 151 BGS 9.5", name: "Lugia", setName: "151", number: undefined, grade: "BGS_9_5" },
  ];

  for (const testCase of cases) {
    const parsed = readCompLookupRequest(new URLSearchParams({ q: testCase.q, grade: testCase.grade ?? "RAW" }));
    assert.deepEqual(
      "card" in parsed
        ? {
            name: parsed.card.name,
            setName: parsed.card.setName,
            number: parsed.card.number,
            grade: parsed.grade,
          }
        : { name: "error", setName: "error", number: "error", grade: "error" },
      {
        name: testCase.name,
        setName: testCase.setName,
        number: testCase.number,
        grade: testCase.grade ?? "RAW",
      },
    );
  }
});

test("readCompLookupRequest parses common promo shorthand from free text", () => {
  const parsed = readCompLookupRequest(
    new URLSearchParams({ q: "Victini 208 IR Promo (SVP) ACE 10" }),
  );
  assert.deepEqual(parsed, {
    card: {
      name: "Victini",
      setName: "Scarlet & Violet Black Star Promos",
      number: "SVP208",
      game: "POKEMON",
      language: "EN",
    },
    grade: "ACE_10",
  });

  const alakazam = readCompLookupRequest(new URLSearchParams({ q: "Alakazam MEP0079" }));
  assert.deepEqual(alakazam, {
    card: {
      name: "Alakazam",
      setName: "Mega Evolution Promos",
      number: "MEP0079",
      game: "POKEMON",
      language: "EN",
    },
    grade: "RAW",
  });

  const rawLugia = readCompLookupRequest(new URLSearchParams({ q: "Lugia Neo Genesis BGS 7.5" }));
  assert.deepEqual(rawLugia, {
    card: {
      name: "Lugia",
      setName: "Neo Genesis",
      number: undefined,
      game: "POKEMON",
      language: "EN",
    },
    grade: "BGS_7_5",
  });

  const cgclogy = readCompLookupRequest(new URLSearchParams({ q: "Lugia Neo Genesis CGC 1.5" }));
  assert.deepEqual(cgclogy, {
    card: {
      name: "Lugia",
      setName: "Neo Genesis",
      number: undefined,
      game: "POKEMON",
      language: "EN",
    },
    grade: "CGC_1_5",
  });
});

test("readCompLookupRequest ignores encoded undefined/null-like number values", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    name: "Umbreon",
    set: "Evolving Skies",
    number: "undefined",
    grade: "RAW",
  }));

  assert.deepEqual(parsed, {
    card: {
      name: "Umbreon",
      setName: "Evolving Skies",
      number: undefined,
      game: "POKEMON",
      language: "EN",
    },
    grade: "RAW",
  });
});

test("readCompLookupRequest ignores n/a as a missing number", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    cardName: "Lugia",
    setName: "Neo Genesis",
    number: "N/A",
    grade: "RAW",
  }));

  assert.equal("error" in parsed ? null : parsed.card.number, undefined);
});

test("readCompLookupRequest normalizes typed slab grades", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    name: "Gengar",
    set: "Lost Origin Trainer Gallery",
    number: "TG06",
    grade: "ACE 10",
  }));

  assert.equal("grade" in parsed ? parsed.grade : null, "ACE_10");

  const lowCgc = readCompLookupRequest(new URLSearchParams({
    name: "Lugia",
    set: "Neo Genesis",
    grade: "CGC 1.5",
  }));

  assert.equal("grade" in lowCgc ? lowCgc.grade : null, "CGC_1_5");

  const bgs = readCompLookupRequest(new URLSearchParams({
    name: "Lugia",
    set: "Neo Genesis",
    grade: "BGS 8.5",
  }));

  assert.equal("grade" in bgs ? bgs.grade : null, "BGS_8_5");
});

test("readCompLookupRequest preserves canonical URL grade values", () => {
  const parsed = readCompLookupRequest(new URLSearchParams({
    name: "Umbreon VMAX",
    grade: "PSA_10",
  }));

  assert.equal("grade" in parsed ? parsed.grade : null, "PSA_10");

  const lowCgc = readCompLookupRequest(new URLSearchParams({
    name: "Lugia",
    grade: "CGC_1_5",
  }));

  assert.equal("grade" in lowCgc ? lowCgc.grade : null, "CGC_1_5");
});

test("readCompLookupRequest requires a card name", () => {
  assert.deepEqual(readCompLookupRequest(new URLSearchParams()), { error: "name is required" });
});
