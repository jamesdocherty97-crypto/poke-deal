import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAllSets,
  getPopularSets,
  getRelatedSubsetIds,
  getSetById,
  resolveSetId,
  resolveSetIdForCard,
  searchSets,
} from "./setCatalog.js";

test("resolveSetId fixes the reported bug: 'base set' resolves to the 1999 Base set", () => {
  // The API's literal set name is just "Base" -- a phrase query for
  // "base set" never matches it. This is the headline fix for James's
  // reported "Charizard 04/102 + base set -> nothing" bug.
  assert.equal(resolveSetId("base set"), "base1");
  assert.equal(resolveSetId("Base Set"), "base1");
  assert.equal(resolveSetId("unlimited base set"), "base1");
  assert.equal(resolveSetId("1st edition base set"), "base1");
});

test("resolveSetId matches exact id, exact literal name, and ptcgoCode", () => {
  assert.equal(resolveSetId("base1"), "base1");
  assert.equal(resolveSetId("BASE1"), "base1");
  assert.equal(resolveSetId("Base"), "base1");
  assert.equal(resolveSetId("BS"), "base1");
  assert.equal(resolveSetId("bs"), "base1");
  // "151" is the literal printed name of the Scarlet & Violet 151 set.
  assert.equal(resolveSetId("151"), "sv3pt5");
});

test("resolveSetId handles other curated nicknames", () => {
  assert.equal(resolveSetId("expedition"), "ecard1");
  assert.equal(resolveSetId("ex base set"), "ecard1");
  assert.equal(resolveSetId("hgss"), "hgss1");
  assert.equal(resolveSetId("heartgold soulsilver"), "hgss1");
});

test("resolveSetId handles dealer shorthand for current chase sets and subsets", () => {
  assert.equal(resolveSetId("sv 151"), "sv3pt5");
  assert.equal(resolveSetId("evo skies"), "swsh7");
  assert.equal(resolveSetId("moonbreon"), "swsh7");
  assert.equal(resolveSetId("prismatic"), "sv8pt5");
  assert.equal(resolveSetId("cz gg"), "swsh12pt5gg");
  assert.equal(resolveSetId("hidden fates sv"), "sma");
  assert.equal(resolveSetId("brs tg"), "swsh9tg");
  assert.equal(resolveSetId("sv promos"), "svp");
});

test("resolveSetIdForCard uses prefixed collector numbers to choose gallery subsets", () => {
  assert.equal(resolveSetIdForCard("Lost Origin", "TG06/TG30"), "swsh11tg");
  assert.equal(resolveSetIdForCard("Lost Origin", "TG06"), "swsh11tg");
  assert.equal(resolveSetIdForCard("Crown Zenith", "GG70/GG70"), "swsh12pt5gg");
  assert.equal(resolveSetIdForCard("Hidden Fates", "SV49/SV94"), "sma");
  assert.equal(resolveSetIdForCard("Lost Origin", "066/196"), "swsh11");
});

test("resolveSetIdForCard does not treat promo prefixes as gallery subsets", () => {
  assert.equal(resolveSetIdForCard("SWSH Promos", "SWSH262"), "swshp");
  assert.equal(resolveSetIdForCard("SV Promos", "SVP085"), "svp");
});

test("getRelatedSubsetIds exposes attached high-volume subsets", () => {
  assert.deepEqual(getRelatedSubsetIds("swsh11"), ["swsh11tg"]);
  assert.deepEqual(getRelatedSubsetIds("swsh12pt5"), ["swsh12pt5gg"]);
  assert.deepEqual(getRelatedSubsetIds("base1"), []);
});

test("resolveSetId returns undefined for unresolvable input and empty/blank input", () => {
  assert.equal(resolveSetId("this is not a real pokemon set at all"), undefined);
  assert.equal(resolveSetId(""), undefined);
  assert.equal(resolveSetId("   "), undefined);
  assert.equal(resolveSetId(undefined), undefined);
});

test("searchSets ranks the exact set above longer sets that merely contain the same words", () => {
  // Historical bug: scoring by substring containment rewarded "Base Set 2"
  // and "Expedition Base Set" over "Base" for query "base", since both
  // contain that substring while "Base" doesn't contain itself as a
  // *substring of the query*. Token-subset scoring + the alias table fixes
  // this -- "Base" must come first.
  const results = searchSets("base set");
  assert.equal(results[0]?.id, "base1");

  const looseResults = searchSets("base");
  assert.equal(looseResults[0]?.id, "base1");
});

test("searchSets tolerates common typos", () => {
  assert.equal(searchSets("Evolvng Skies")[0]?.id, "swsh7");
  assert.equal(searchSets("Paldean Fate")[0]?.id, "sv4pt5");
});

test("searchSets returns nothing for blank queries", () => {
  assert.deepEqual(searchSets(""), []);
  assert.deepEqual(searchSets("   "), []);
});

test("getPopularSets returns the curated quick-pick list in order", () => {
  const popular = getPopularSets();
  assert.ok(popular.length >= 70);
  assert.equal(popular[0]?.id, "sv8pt5");
  assert.ok(popular.some((set) => set.id === "swsh12pt5gg"));
  assert.ok(popular.some((set) => set.id === "swsh11tg"));
  assert.ok(popular.some((set) => set.id === "swsh12tg"));
  assert.ok(popular.some((set) => set.id === "sv8"));
  assert.ok(popular.some((set) => set.id === "sv10"));
  assert.ok(popular.every((set) => typeof set.name === "string" && set.name.length > 0));
});

test("getAllSets returns the full bundled snapshot sorted newest first", () => {
  const all = getAllSets();
  assert.equal(all.length, 173);

  for (let i = 1; i < all.length; i++) {
    const prevDate = all[i - 1]?.releaseDate ?? "";
    const currDate = all[i]?.releaseDate ?? "";
    assert.ok(prevDate >= currDate, `expected ${prevDate} >= ${currDate} at index ${i}`);
  }

  const ids = new Set(all.map((set) => set.id));
  assert.equal(ids.size, all.length, "set ids should be unique");
});

test("getSetById returns the matching set or undefined", () => {
  assert.equal(getSetById("base1")?.name, "Base");
  assert.equal(getSetById("not-a-real-id"), undefined);
});
