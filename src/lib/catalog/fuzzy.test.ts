import { test } from "node:test";
import assert from "node:assert/strict";
import {
  damerauLevenshtein,
  normalizeSearchText,
  scoreSearchText,
  tokenMatches,
} from "./fuzzy.js";

test("normalizeSearchText strips punctuation, diacritics and gender symbols", () => {
  assert.equal(normalizeSearchText("Pokémon Mr. Mime ♀"), "pokemon mr mime f");
  assert.equal(normalizeSearchText("Nidoran♂"), "nidoran m");
  assert.equal(normalizeSearchText("HeartGold & SoulSilver"), "heartgold and soulsilver");
});

test("damerauLevenshtein handles edits and transpositions", () => {
  assert.equal(damerauLevenshtein("charzard", "charizard"), 1);
  assert.equal(damerauLevenshtein("psa", "psa"), 0);
  assert.equal(damerauLevenshtein("abcd", "acbd"), 1);
});

test("tokenMatches allows partial typing and single-character typos", () => {
  assert.equal(tokenMatches("evolvng", "evolving"), true);
  assert.equal(tokenMatches("evo", "evolving"), true);
  assert.equal(tokenMatches("base", "jungle"), false);
});

test("scoreSearchText ranks typo matches without matching unrelated text", () => {
  assert.ok(scoreSearchText("Charzard", "Charizard ex") > 0);
  assert.ok(scoreSearchText("Mr Mime", "Mr. Mime") > 0);
  assert.equal(scoreSearchText("Charzard", "Pikachu ex"), 0);
});
