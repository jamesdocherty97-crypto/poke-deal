import assert from "node:assert/strict";
import test from "node:test";

import { buildManualCompLinks, cardSearchQuery, ebaySoldSearchQuery, normalizeManualCompSearchText } from "./compLinks.js";

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

  assert.equal(links[0]?.label, "eBay UK");
  assert.equal(ebay.hostname, "www.ebay.co.uk");
  assert.equal(ebay.searchParams.get("LH_Sold"), "1");
  assert.equal(ebay.searchParams.get("LH_PrefLoc"), "1");
  assert.equal(ebay.searchParams.get("_nkw"), "Gengar TG06/TG30 Lost Origin Trainer Gallery -PSA -BGS -CGC -ACE -SGC -graded");
  assert.equal(links[0]?.primary, true);
  assert.equal(links[1]?.label, "Widen");
  assert.equal(new URL(links[1]!.url).searchParams.get("LH_PrefLoc"), null);
  assert.equal(new URL(links[2]!.url).hostname, "www.cardmarket.com");
  assert.equal(new URL(links[3]!.url).hostname, "www.tcgplayer.com");
});

test("buildManualCompLinks adds slab grade only to eBay sold searches", () => {
  const links = buildManualCompLinks(card, "BGS_9_5");

  assert.match(new URL(links[0]!.url).searchParams.get("_nkw") ?? "", /BGS 9\.5/);
  assert.doesNotMatch(new URL(links[0]!.url).searchParams.get("_nkw") ?? "", /-PSA/);
  assert.doesNotMatch(new URL(links[2]!.url).searchParams.get("searchString") ?? "", /BGS/);
  assert.doesNotMatch(new URL(links[3]!.url).searchParams.get("q") ?? "", /BGS/);
});

test("buildManualCompLinks adds ACE slab grades to eBay sold searches", () => {
  const links = buildManualCompLinks(card, "ACE_10");

  assert.match(new URL(links[0]!.url).searchParams.get("_nkw") ?? "", /ACE 10/);
  assert.doesNotMatch(new URL(links[2]!.url).searchParams.get("searchString") ?? "", /ACE/);
});

test("buildManualCompLinks preserves typed vintage qualifiers for eBay", () => {
  const links = buildManualCompLinks(
    { name: "Hitmontop", setName: "Neo Genesis" },
    "RAW",
    { searchText: "Hitmontop - Neo Genesis - 1st Edition - LP paid £12 from card fair binder" },
  );
  const ebay = new URL(links[0]!.url);

  assert.equal(ebay.searchParams.get("_nkw"), "Hitmontop Neo Genesis 1st Edition LP -PSA -BGS -CGC -ACE -SGC -graded");
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

test("normalizeManualCompSearchText joins modern promo codes for manual eBay searches", () => {
  assert.equal(normalizeManualCompSearchText("Snivy MEP 049 raw £2"), "Snivy MEP049");
  assert.equal(normalizeManualCompSearchText("Pikachu SVP 085 LP"), "Pikachu SVP085 LP");
  assert.equal(normalizeManualCompSearchText("Snivy XYZ 001 raw £2"), "Snivy XYZ001");
});

test("ebaySoldSearchQuery keeps explicit graded wording instead of adding raw exclusions", () => {
  assert.equal(ebaySoldSearchQuery("Umbreon VMAX PSA 10", "RAW"), "Umbreon VMAX PSA 10");
  assert.equal(ebaySoldSearchQuery("Umbreon VMAX", "PSA_10"), "Umbreon VMAX PSA 10");
});
