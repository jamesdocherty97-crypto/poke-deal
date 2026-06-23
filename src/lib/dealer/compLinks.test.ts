import assert from "node:assert/strict";
import test from "node:test";

import { buildManualCompLinks, cardSearchQuery } from "./compLinks.js";

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

  assert.equal(links[0]?.label, "eBay sold");
  assert.equal(ebay.hostname, "www.ebay.co.uk");
  assert.equal(ebay.searchParams.get("LH_Sold"), "1");
  assert.equal(ebay.searchParams.get("_nkw"), "Gengar TG06/TG30 Lost Origin Trainer Gallery");
  assert.equal(new URL(links[1]!.url).hostname, "www.cardmarket.com");
  assert.equal(new URL(links[2]!.url).hostname, "www.tcgplayer.com");
});

test("buildManualCompLinks adds slab grade only to eBay sold searches", () => {
  const links = buildManualCompLinks(card, "BGS_9_5");

  assert.match(new URL(links[0]!.url).searchParams.get("_nkw") ?? "", /BGS 9\.5/);
  assert.doesNotMatch(new URL(links[1]!.url).searchParams.get("searchString") ?? "", /BGS/);
  assert.doesNotMatch(new URL(links[2]!.url).searchParams.get("q") ?? "", /BGS/);
});
