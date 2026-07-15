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
  listingPackCsvHeader,
  listingPackCopyFields,
  suggestListPricePence,
  suggestPostage,
} from "./listingPack.js";
import { listingEvidenceFromPreview } from "./listingEvidence.js";

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

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

function csvRecord(csv: string, row = 1): Record<string, string> {
  const lines = csv.split("\n");
  const headers = parseCsvLine(lines[0]!);
  const values = parseCsvLine(lines[row]!);
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

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

test("Kofu keeps the complete catalogue identity in the eBay title", () => {
  assert.equal(
    buildEbayTitle({
      card: { name: "Kofu", setName: "Stellar Crown", number: "165/142", language: "EN" },
      grade: "RAW",
      condition: "NM",
    }),
    "Pokemon TCG Kofu Stellar Crown 165/142 NM Raw English",
  );
});

test("long eBay titles preserve collector number and slab grade within 80 characters", () => {
  const title = buildEbayTitle({
    card: {
      name: "Reshiram & Charizard-GX Special Alternate Art Promotional Card",
      setName: "Sun & Moon Unbroken Bonds Collector Anniversary Collection",
      number: "SM247",
      language: "EN",
    },
    grade: "PSA_10",
  });

  assert.ok(title.length <= 80, `title too long: ${title.length}`);
  assert.match(title, /SM247/);
  assert.match(title, /PSA 10 GEM MINT/);
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

test("descriptions mention sold pricing only with a complete evidence receipt", () => {
  const completeEvidence = {
    sampleSize: 14,
    windowDays: 30,
    compAsOf: "2026-07-10T18:30:00Z",
    sourceRegion: "  UK   sold listings ",
  };

  for (const channel of ["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"] as const) {
    const pack = buildListingPack({ ...moonbreon, channel, soldEvidence: completeEvidence });
    assert.match(
      pack.description,
      /Recent sold evidence centres around £285\.00 \(n=14 across a 30-day window, as of 2026-07-10, UK sold listings\)\./,
      channel,
    );
  }
});

test("history preview evidence maps atomically into buyer-facing listing fields", () => {
  const fields = listingEvidenceFromPreview({
    key: "card_1|RAW",
    cardId: "card_1",
    grade: "RAW",
    range: { from: "2026-06-10T00:00:00.000Z", to: "2026-07-10T00:00:00.000Z" },
    market: [{ takenAt: "2026-07-10T00:00:00.000Z", marketPence: 4_200 }],
    soldEvidence: {
      source: "checked-comps",
      medianPence: 4_200,
      sampleSize: 7,
      windowDays: 90,
      asOf: "2026-07-10T00:00:00.000Z",
      sourceRegion: "EU",
    },
  });
  assert.deepEqual(fields, {
    compMedianPence: 4_200,
    soldEvidence: {
      sampleSize: 7,
      windowDays: 90,
      compAsOf: "2026-07-10T00:00:00.000Z",
      sourceRegion: "EU",
    },
  });
  assert.match(buildListingPack({ ...moonbreon, ...fields }).description, /£42\.00.*n=7.*90-day.*EU/);
});

test("history preview mapper drops incomplete evidence rather than exposing a bare median", () => {
  const fields = listingEvidenceFromPreview({
    key: "card_1|RAW",
    cardId: "card_1",
    grade: "RAW",
    range: { from: "2026-06-10T00:00:00.000Z", to: "2026-07-10T00:00:00.000Z" },
    market: [{ takenAt: "2026-07-10T00:00:00.000Z", marketPence: 4_200 }],
    soldEvidence: {
      source: "owned-sales",
      medianPence: 4_200,
      sampleSize: 0,
      windowDays: 90,
      asOf: "2026-07-10T00:00:00.000Z",
    },
  });
  assert.deepEqual(fields, {});
});

test("descriptions never expose a bare comp price when evidence context is incomplete", () => {
  const incompleteEvidence = [
    undefined,
    { sampleSize: 14 },
    { sampleSize: 14, windowDays: 30 },
    { sampleSize: 0, windowDays: 30, compAsOf: "2026-07-10" },
    { sampleSize: 14, windowDays: 0, compAsOf: "2026-07-10" },
    { sampleSize: 14, windowDays: 30, compAsOf: "not-a-date" },
  ];

  for (const soldEvidence of incompleteEvidence) {
    const description = buildListingPack({ ...moonbreon, soldEvidence }).description;
    assert.doesNotMatch(description, /Recent sold evidence/);
    assert.doesNotMatch(description, /£285\.00/);
  }

  const missingMedian = buildListingPack({
    ...moonbreon,
    compMedianPence: 0,
    soldEvidence: { sampleSize: 14, windowDays: 30, compAsOf: new Date("2026-07-10T12:00:00Z") },
  });
  assert.doesNotMatch(missingMedian.description, /Recent sold evidence|£0\.00/);
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

test("default and explicit eBay CSVs preserve the existing File Exchange schema", () => {
  const expectedHeader = [
    "Action(SiteID=UK|Country=GB|Currency=GBP|Version=1193)",
    "Category",
    "Title",
    "Description",
    "Condition",
    "Quantity",
    "Format",
    "StartPrice",
    "PostageService-1:Option",
    "PostageService-1:Cost",
    "DispatchTimeMax",
    "ReturnsAcceptedOption",
    "CustomLabel",
    "ItemSpecifics:Game",
    "ItemSpecifics:Card Name",
    "ItemSpecifics:Set",
    "ItemSpecifics:Card Number",
    "ItemSpecifics:Professional Grader",
    "ItemSpecifics:Grade",
    "ItemSpecifics:Certification Number",
  ].join(",");

  assert.equal(listingPackCsvHeader(), expectedHeader);
  assert.equal(buildListingPackCsv([]), expectedHeader);

  const implicit = buildListingPackCsv([moonbreon]);
  const explicit = buildListingPackCsv([{ ...moonbreon, channel: "EBAY" }]);
  assert.equal(implicit, explicit);
  assert.deepEqual(
    {
      action: csvRecord(explicit)[expectedHeader.split(",")[0]!],
      category: csvRecord(explicit).Category,
      format: csvRecord(explicit).Format,
      startPrice: csvRecord(explicit).StartPrice,
      postage: csvRecord(explicit)["PostageService-1:Option"],
    },
    {
      action: "Add",
      category: "183454",
      format: "FixedPrice",
      startPrice: "285.00",
      postage: "UK_RoyalMailFirstClassStandard",
    },
  );
});

test("Cardmarket CSV uses stock-prep fields and Cardmarket condition codes", () => {
  const csv = buildListingPackCsv([
    { ...moonbreon, channel: "CARDMARKET" },
    { ...slab, channel: "CARDMARKET" },
  ]);
  const lines = csv.split("\n");
  assert.equal(
    lines[0],
    "Card Name,Expansion,Collector Number,Language,Condition,Professional Grader,Grade,Certification Number,Price (GBP),Quantity,Comments",
  );
  assert.equal(lines.length, 3);
  assert.equal(csv.includes("Action(SiteID"), false);

  const raw = csvRecord(csv, 1);
  assert.equal(raw["Card Name"], "Umbreon VMAX");
  assert.equal(raw.Expansion, "Evolving Skies");
  assert.equal(raw.Language, "English");
  assert.equal(raw.Condition, "NM");
  assert.equal(raw["Price (GBP)"], "285.00");
  assert.match(raw.Comments ?? "", /Cardmarket condition: NM/);

  const graded = csvRecord(csv, 2);
  assert.equal(graded.Condition, "Graded");
  assert.equal(graded["Professional Grader"], "PSA");
  assert.equal(graded.Grade, "10");
  assert.equal(graded["Certification Number"], "84213567");
});

test("Vinted CSV uses manual-listing fields, buyer shipping assumptions and generic condition", () => {
  const csv = buildListingPackCsv([{ ...moonbreon, channel: "VINTED", condition: "LP" }]);
  assert.equal(
    csv.split("\n")[0],
    "Title,Description,Category,Brand,Condition,Price (GBP),Parcel Size,Quantity,Reference",
  );
  assert.equal(csv.includes("PostageService-1:Option"), false);

  const row = csvRecord(csv);
  assert.match(row.Title ?? "", /Umbreon VMAX/);
  assert.match(row.Description ?? "", /Happy to bundle/);
  assert.equal(row.Category, "Hobbies & collectables > Trading cards");
  assert.equal(row.Brand, "Pokémon");
  assert.equal(row.Condition, "Good");
  assert.equal(row["Price (GBP)"], "285.00");
  assert.equal(row["Parcel Size"], "Small");
});

test("in-person CSV is a handover price sheet rather than a marketplace upload", () => {
  const csv = buildListingPackCsv([{ ...slab, channel: "IN_PERSON" }]);
  assert.equal(
    csv.split("\n")[0],
    "Item,Set,Collector Number,Grade / Condition,Certification Number,Asking Price (GBP),Quantity,Handover,Notes",
  );

  const row = csvRecord(csv);
  assert.equal(row.Item, "Charizard ex");
  assert.equal(row["Grade / Condition"], "PSA 10 GEM MINT");
  assert.equal(row["Certification Number"], "84213567");
  assert.equal(row["Asking Price (GBP)"], "1063.00");
  assert.equal(row.Handover, "Collection / handover");
  assert.match(row.Notes ?? "", /Buyer can inspect before payment/);
});

test("CSV export rejects mixed channels instead of labelling rows with the wrong schema", () => {
  assert.throws(
    () => buildListingPackCsv([{ ...moonbreon, channel: "CARDMARKET" }, { ...slab, channel: "VINTED" }]),
    /only contain one channel/,
  );
  assert.throws(
    () => buildListingPackCsv([moonbreon, { ...slab, channel: "EBAY" }, { ...slab, channel: "IN_PERSON" }]),
    /only contain one channel/,
  );
});
