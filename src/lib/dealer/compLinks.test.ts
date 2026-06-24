import assert from "node:assert/strict";
import test from "node:test";

import { buildManualCompLinks, cardSearchQuery, normalizeManualCompSearchText } from "./compLinks.js";

const card = {
  name: "Gengar",
  setName: "Lost Origin Trainer Gallery",
  number: "TG06/TG30",
} as const;

test("cardSearchQuery builds the exact dealer search string", () => {
  assert.equal(cardSearchQuery(card), "Gengar TG06/TG30 Lost Origin Trainer Gallery");
});

test("buildManualCompLinks creates UK-relevant raw comp links", () => {
  const links = buildManualCompLinks(card, "RAW");
  const ebay = new URL(links[0]!.url);

  assert.equal(links[0]?.label, "eBay UK sold");
  assert.equal(ebay.hostname, "www.ebay.co.uk");
  assert.equal(ebay.searchParams.get("LH_Sold"), "1");
  assert.equal(ebay.searchParams.get("LH_PrefLoc"), "1");
  assert.equal(ebay.searchParams.get("_nkw"), "Gengar TG06/TG30 Lost Origin Trainer Gallery");
  assert.equal(links[1]?.label, "eBay all sold");
  assert.equal(new URL(links[1]!.url).searchParams.get("LH_PrefLoc"), null);
  assert.equal(new URL(links[2]!.url).hostname, "www.cardmarket.com");
  assert.equal(new URL(links[3]!.url).hostname, "www.tcgplayer.com");
});

test("buildManualCompLinks adds slab grade only to eBay sold searches", () => {
  const links = buildManualCompLinks(card, "BGS_9_5");

  assert.match(new URL(links[0]!.url).searchParams.get("_nkw") ?? "", /BGS 9\.5/);
  assert.doesNotMatch(new URL(links[2]!.url).searchParams.get("searchString") ?? "", /BGS/);
  assert.doesNotMatch(new URL(links[3]!.url).searchParams.get("q") ?? "", /BGS/);
});

test("buildManualCompLinks preserves typed vintage qualifiers for eBay", () => {
  const links = buildManualCompLinks(
    { name: "Hitmontop", setName: "Neo Genesis" },
    "RAW",
    { searchText: "Hitmontop - Neo Genesis - 1st Edition - LP paid £12 from card fair binder" },
  );
  const ebay = new URL(links[0]!.url);

  assert.equal(ebay.searchParams.get("_nkw"), "Hitmontop Neo Genesis 1st Edition LP");
  assert.equal(ebay.searchParams.get("LH_PrefLoc"), "1");
});

test("cardSearchQuery includes non-NM condition for manual fallbacks", () => {
  assert.equal(cardSearchQuery({ name: "Hitmontop", setName: "Neo Genesis" }, { condition: "LP" }), "Hitmontop Neo Genesis LP");
  assert.equal(cardSearchQuery({ name: "Hitmontop", setName: "Neo Genesis" }, { condition: "NM" }), "Hitmontop Neo Genesis");
});

test("normalizeManualCompSearchText strips buy-flow noise but keeps comp qualifiers", () => {
  assert.equal(
    normalizeManualCompSearchText("2x Hitmontop - Neo Genesis - 1st Edition - LP raw £12 vinted binder"),
    "Hitmontop Neo Genesis 1st Edition LP",
  );
});
