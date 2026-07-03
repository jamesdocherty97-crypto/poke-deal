import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEbayTitle,
  cardmarketConditionCode,
  DEFAULT_LISTING_COPY_SETTINGS,
  gradeListingPhrase,
  buildItemSpecifics,
  buildListingPack,
  buildListingPackCsv,
  ebayCondition,
  listingPackCopyFields,
  suggestListPricePence,
  suggestPostage,
} from "./listingPack.js";

const moonbreon = {
  card: { name: "Umbreon VMAX", setName: "Evolving Skies", number: "215/203", rarity: "Secret Rare", language: "EN" },
  grade: "RAW",
  compMedianPence: 28500,
  costBasisPence: 18000,
  condition: "Near Mint",
};

const slab = {
  card: { name: "Charizard ex", setName: "151", number: "199/165", rarity: "Special Illustration Rare", language: "EN" },
  grade: "PSA_10",
  compMedianPence: 106220,
  costBasisPence: 70000,
  certNumber: "84213567",
};

test("eBay title stays within 80 chars and keeps whole words", () => {
  const title = buildEbayTitle(moonbreon);
  assert.ok(title.length <= 80, `title too long: ${title.length}`);
  assert.match(title, /^Pokemon TCG Umbreon VMAX Evolving Skies 215\/203/);
  assert.match(title, /Umbreon VMAX/);
  assert.match(title, /215\/203/);
  assert.ok(!title.endsWith(" "), "no trailing space");
});

test("graded title includes exact slab wording", () => {
  const title = buildEbayTitle(slab);
  assert.match(title, /PSA 10 GEM MINT/);
  assert.ok(title.length <= 80);
});

test("grade listing phrase handles common whole and half grades", () => {
  assert.equal(gradeListingPhrase("PSA_10"), "PSA 10 GEM MINT");
  assert.equal(gradeListingPhrase("BGS_9.5"), "BGS 9.5 GEM MINT");
  assert.equal(gradeListingPhrase("CGC_8"), "CGC 8 NM-MT");
});

test("condition differs for raw vs graded", () => {
  assert.equal(ebayCondition(moonbreon).condition, "Ungraded");
  assert.equal(ebayCondition(slab).condition, "Graded");
  assert.match(ebayCondition(slab).conditionNote, /84213567/);
});

test("item specifics include grader + cert for graded cards", () => {
  const specifics = buildItemSpecifics(slab);
  assert.equal(specifics.Game, "Pokémon TCG");
  assert.equal(specifics["Professional Grader"], "PSA");
  assert.equal(specifics.Grade, "10");
  assert.equal(specifics.Certification, "84213567");
  assert.equal(specifics.Set, "151");
});

test("ACE slabs produce ACE listing titles and specifics", () => {
  const aceSlab = { ...slab, grade: "ACE_10", certNumber: "ACE12345" };
  const title = buildEbayTitle(aceSlab);
  const specifics = buildItemSpecifics(aceSlab);

  assert.match(title, /ACE 10 GEM MINT/);
  assert.equal(specifics["Professional Grader"], "ACE");
  assert.equal(specifics.Grade, "10");
  assert.equal(specifics.Certification, "ACE12345");
});

test("raw item specifics carry the condition, not a grader", () => {
  const specifics = buildItemSpecifics(moonbreon);
  assert.equal(specifics["Card Condition"], "Near Mint");
  assert.equal(specifics["Professional Grader"], undefined);
});

test("suggested price anchors on comp but never lists below cost+margin", () => {
  // comp 285.00 > floor 180*1.35=243 -> rounds up to whole pound
  assert.equal(suggestListPricePence(moonbreon), 28500);
  // comp missing -> uses cost floor
  assert.equal(suggestListPricePence({ ...moonbreon, compMedianPence: 0 }), Math.ceil(18000 * 1.35 / 100) * 100);
  // tiny price rounds to nearest 50p
  assert.equal(suggestListPricePence({ card: { name: "X" }, grade: "RAW", compMedianPence: 320 }), 350);
});

test("saved listing prices are used exactly in packs and CSV exports", () => {
  const input = {
    ...moonbreon,
    listPricePence: 1234,
    compMedianPence: 1200,
    costBasisPence: 1000,
  };

  assert.equal(suggestListPricePence(input), 1234);

  const pack = buildListingPack(input);
  assert.match(pack.copyReady, /PRICE: £12\.34/);

  const csv = buildListingPackCsv([input]);
  assert.match(csv, /,12\.34,/);
});

test("postage is tracked/signed for graded slabs, large letter for raw", () => {
  assert.match(suggestPostage(slab).service, /Special Delivery|Tracked|signed/i);
  assert.match(suggestPostage(moonbreon).service, /Large Letter/);
});

test("manual marketplace packs use channel-specific copy and postage assumptions", () => {
  const vintedPack = buildListingPack({ ...moonbreon, channel: "VINTED" });
  const cardmarketPack = buildListingPack({ ...moonbreon, channel: "CARDMARKET" });

  assert.match(vintedPack.copyReady, /CHANNEL: Vinted/);
  assert.match(vintedPack.copyReady, /Buyer pays Vinted postage/);
  assert.doesNotMatch(vintedPack.copyReady, /£1\.75/);
  assert.match(vintedPack.description, /Happy to bundle/);

  assert.match(cardmarketPack.copyReady, /CHANNEL: Cardmarket/);
  assert.match(cardmarketPack.copyReady, /Buyer pays Cardmarket postage/);
  assert.match(cardmarketPack.description, /Cardmarket condition: NM/);
});

test("listing copy settings replace default eBay boilerplate", () => {
  const pack = buildListingPack({
    ...slab,
    copySettings: {
      postageTerms: "Buyer pays postage; slabs ship boxed and tracked.",
      returnsLine: "No returns unless the listing is materially wrong.",
    },
  });

  assert.match(pack.description, /Buyer pays postage; slabs ship boxed and tracked/);
  assert.match(pack.description, /No returns unless/);
  assert.equal(pack.description.includes(DEFAULT_LISTING_COPY_SETTINGS.postageTerms), false);
});

test("eBay catalog-only listing packs include the stock image disclosure", () => {
  const pack = buildListingPack({ ...moonbreon, usesCatalogOnlyImages: true });
  assert.match(pack.description, /Stock image shown — you will receive the card pictured in the title, in the condition stated\./);
  assert.equal(pack.photoDisclosure, "Stock image shown — you will receive the card pictured in the title, in the condition stated.");
  assert.match(pack.copyReady, /Stock image shown/);

  const vintedPack = buildListingPack({ ...moonbreon, channel: "VINTED", usesCatalogOnlyImages: true });
  assert.doesNotMatch(vintedPack.description, /Stock image shown/);
  assert.equal(vintedPack.photoDisclosure, null);
});

test("Cardmarket condition mapping normalises common raw grades", () => {
  assert.equal(cardmarketConditionCode("Near Mint"), "NM");
  assert.equal(cardmarketConditionCode("LP"), "EX");
  assert.equal(cardmarketConditionCode("Moderately Played"), "GD");
});

test("listing pack produces a copy-ready block", () => {
  const pack = buildListingPack(slab);
  assert.match(pack.copyReady, /CHANNEL: eBay/);
  assert.match(pack.copyReady, /TITLE:/);
  assert.match(pack.copyReady, /PRICE: £1063\.00/); // 1062.20 rounded up to a tidy whole pound
  assert.match(pack.copyReady, /ITEM SPECIFICS:/);
  assert.match(pack.copyReady, /DESCRIPTION:/);
});

test("listing pack exposes field-level copy values for manual listing", () => {
  const pack = buildListingPack(slab);
  const fields = listingPackCopyFields(pack);

  assert.equal(fields.find((field) => field.key === "title")?.value, pack.title);
  assert.equal(fields.find((field) => field.key === "price")?.value, "1063.00");
  assert.match(fields.find((field) => field.key === "description")?.value ?? "", /Charizard ex/);
  assert.match(fields.find((field) => field.key === "specifics")?.value ?? "", /Professional Grader: PSA/);
});

test("CSV export has a header and one row per item, with quoting", () => {
  const quoteCard = {
    ...moonbreon,
    card: { ...moonbreon.card, name: 'Pikachu "Promo"', setName: "Scarlet, Violet Promos" },
  };
  const csv = buildListingPackCsv([quoteCard, slab]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 3); // header + 2
  assert.match(lines[0]!, /^Action\(SiteID=UK\|Country=GB\|Currency=GBP\|Version=1193\),Category,Title/);
  assert.match(lines[0]!, /StartPrice/);
  assert.match(lines[1]!, /"Pikachu ""Promo""/);
  assert.match(lines[1]!, /"Scarlet, Violet Promos/);
  assert.match(lines[2]!, /Charizard ex/);
});
