import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManualCompFallbackQuery,
  buildManualCompLinks,
  cardSearchQuery,
  ebaySoldSearchQuery,
  normalizeManualCompSearchText,
} from "./compLinks.js";

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

  assert.equal(
    new URL(links[0]!.url).searchParams.get("_nkw"),
    "Gengar TG06/TG30 Lost Origin Trainer Gallery BGS 9.5",
  );
  assert.doesNotMatch(new URL(links[0]!.url).searchParams.get("_nkw") ?? "", /-PSA/);
  assert.doesNotMatch(new URL(links[2]!.url).searchParams.get("searchString") ?? "", /BGS/);
  assert.doesNotMatch(new URL(links[3]!.url).searchParams.get("q") ?? "", /BGS/);
});

test("buildManualCompLinks adds ACE slab grades to eBay sold searches using plain human wording", () => {
  const links = buildManualCompLinks(card, "ACE_10");

  assert.equal(
    new URL(links[0]!.url).searchParams.get("_nkw"),
    "Gengar TG06/TG30 Lost Origin Trainer Gallery ACE 10",
  );
  assert.doesNotMatch(new URL(links[2]!.url).searchParams.get("searchString") ?? "", /ACE/);
});

test("buildManualCompLinks formats low CGC half grades for eBay sold searches", () => {
  const links = buildManualCompLinks({ name: "Lugia", setName: "Neo Genesis", number: "9" }, "CGC_1_5");

  assert.equal(new URL(links[0]!.url).searchParams.get("_nkw"), "Lugia 9 Neo Genesis CGC 1.5");
});

test("buildManualCompLinks formats BGS half grades for eBay sold searches", () => {
  const links = buildManualCompLinks({ name: "Lugia", setName: "Neo Genesis" }, "BGS_8_5");

  assert.equal(new URL(links[0]!.url).searchParams.get("_nkw"), "Lugia Neo Genesis BGS 8.5");
});

test("buildManualCompLinks uses plain human grade wording for all slab companies (no boolean syntax)", () => {
  assert.equal(ebaySoldSearchQuery("Victini SVP208", "ACE_10"), "Victini SVP 208 ACE 10");
  assert.equal(ebaySoldSearchQuery("Charizard 151", "PSA_10"), "Charizard 151 PSA 10");
  assert.equal(ebaySoldSearchQuery("Lugia Neo Genesis", "CGC_9_5"), "Lugia Neo Genesis CGC 9.5");
  assert.equal(ebaySoldSearchQuery("Lugia Neo Genesis", "BGS_7_5"), "Lugia Neo Genesis BGS 7.5");
});

test("ebaySoldSearchQuery never emits bracketed/boolean grade syntax for graded searches", () => {
  for (const [query, grade] of [
    ["Victini SVP 208", "ACE_10"],
    ["Charizard 151", "PSA_10"],
    ["Lugia Neo Genesis", "BGS_9_5"],
    ["Lugia Neo Genesis", "CGC_1_5"],
  ] as const) {
    const result = ebaySoldSearchQuery(query, grade);
    assert.doesNotMatch(result, /\(.*OR.*\)/);
    assert.doesNotMatch(result, /"/);
  }
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
  assert.equal(cardSearchQuery({ name: "", setName: "", number: "" }, { condition: "LP" }), "");
});

test("buildManualCompFallbackQuery preserves typed vintage qualifiers after catalog canonicalization", () => {
  assert.equal(
    buildManualCompFallbackQuery(
      { name: "Hitmontop", setName: "Neo Genesis", number: "3/111" },
      { typedText: "Neo Genesis 1st Ed Hitmontop LP raw £35" },
    ),
    "Hitmontop 3/111 Neo Genesis 1st Edition LP",
  );
});

test("buildManualCompLinks uses typed fallback qualifiers when no manual search override is set", () => {
  const links = buildManualCompLinks(
    { name: "Hitmontop", setName: "Neo Genesis", number: "3/111" },
    "RAW",
    { typedText: "Neo Genesis 1st Ed Hitmontop LP raw £35" },
  );

  assert.equal(
    new URL(links[0]!.url).searchParams.get("_nkw"),
    "Hitmontop 3/111 Neo Genesis 1st Edition LP -PSA -BGS -CGC -ACE -SGC -graded",
  );
});

test("normalizeManualCompSearchText strips buy-flow noise but keeps comp qualifiers", () => {
  assert.equal(
    normalizeManualCompSearchText("2x Hitmontop - Neo Genesis - 1st Edition - LP raw £12 vinted binder"),
    "Hitmontop Neo Genesis 1st Edition LP",
  );
  assert.equal(
    normalizeManualCompSearchText("Gengar lor tg TG06 raw £10 from vinted binder list on ebay draft"),
    "Gengar lor tg TG06",
  );
});

test("normalizeManualCompSearchText spaces modern promo codes into human wording for manual eBay searches", () => {
  assert.equal(normalizeManualCompSearchText("Snivy MEP 049 raw £2"), "Snivy MEP 049");
  assert.equal(normalizeManualCompSearchText("Alakazam MEP0079 raw"), "Alakazam MEP 079");
  assert.equal(normalizeManualCompSearchText("Pikachu SVP 085 LP"), "Pikachu SVP 085 LP");
  assert.equal(normalizeManualCompSearchText("Victini 208 IR Promo (SVP) ACE 10"), "Victini SVP 208 ACE 10");
  assert.equal(normalizeManualCompSearchText("Victini SVP208 ACE 10"), "Victini SVP 208 ACE 10");
  // Unrecognized prefixes aren't a real collector-number convention, so leave them as typed.
  assert.equal(normalizeManualCompSearchText("Snivy XYZ 001 raw £2"), "Snivy XYZ 001");
});

test("cardSearchQuery humanizes joined promo catalog numbers for user-facing search text", () => {
  assert.equal(cardSearchQuery({ name: "Victini", setName: "Scarlet & Violet Promos", number: "SVP208" }), "Victini SVP 208 Scarlet & Violet Promos");
  assert.equal(cardSearchQuery({ name: "Alakazam", setName: "McDonald's Promos", number: "MEP0079" }), "Alakazam MEP 079 McDonald's Promos");
  // Galarian/Trainer Gallery joined numbers are the standard convention — left untouched.
  assert.equal(cardSearchQuery({ name: "Gengar", setName: "Lost Origin Trainer Gallery", number: "TG06/TG30" }), "Gengar TG06/TG30 Lost Origin Trainer Gallery");
});

test("normalizeManualCompSearchText keeps ex card names separate from collector numbers", () => {
  assert.equal(normalizeManualCompSearchText("Charizard ex 199/165 151"), "Charizard ex 199/165 151");
  assert.equal(normalizeManualCompSearchText("Mew GX 242/236 Unified Minds"), "Mew GX 242/236 Unified Minds");
  assert.equal(normalizeManualCompSearchText("Lugia 9 Neo Genesis CGC 1.5"), "Lugia 9 Neo Genesis CGC 1.5");
});

test("ebaySoldSearchQuery keeps explicit graded wording instead of adding raw exclusions", () => {
  assert.equal(ebaySoldSearchQuery("Umbreon VMAX PSA 10", "RAW"), "Umbreon VMAX PSA 10");
  assert.equal(ebaySoldSearchQuery("Lugia Neo Genesis CGC 1.5", "RAW"), "Lugia Neo Genesis CGC 1.5");
  assert.equal(ebaySoldSearchQuery("Umbreon VMAX", "PSA_10"), "Umbreon VMAX PSA 10");
  assert.equal(ebaySoldSearchQuery("Umbreon VMAX PSA10", "PSA_10"), "Umbreon VMAX PSA10");
});
