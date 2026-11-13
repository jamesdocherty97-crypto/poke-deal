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
  ebayCsvRowAction,
  listingPackCsvHeader,
  type ListingPackInput,
  listingPackCopyFields,
  normalizeListingRawCondition,
  suggestListPricePence,
  suggestPostage,
} from "./listingPack.js";
import { listingEvidenceFromPreview } from "./listingEvidence.js";
import { buildInventoryItemPayload, type EbayConditionDescriptor } from "../ebay/inventoryItem.js";
import { GET as listingPackExportGET } from "../../app/api/export/listing-pack/route.js";

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
  assert.equal(specifics.Features, undefined);
  assert.equal(specifics.Finish, undefined);
});

test("listing copy never invents a condition for uninspected raw stock", () => {
  for (const channel of ["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"] as const) {
    const input = { ...moonbreon, condition: undefined, channel };
    const pack = buildListingPack(input);
    assert.doesNotMatch(pack.copyReady, /Near Mint|\bNM\b/);
    assert.match(pack.copyReady, /Condition not recorded/);
    assert.doesNotMatch(buildListingPackCsv([input]), /Near Mint|\bNM\b/);
  }
});

test("all listing channels preserve the recorded edition and finish", () => {
  for (const channel of ["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"] as const) {
    const input = {
      ...moonbreon,
      card: { name: "Pikachu", setName: "Jungle", number: "60/64", edition: "FIRST_EDITION", finish: "NORMAL" },
      channel,
    };
    const pack = buildListingPack(input);
    assert.match(pack.title, /1st Edition Non-Holo/);
    assert.match(pack.description, /Printing: 1st Edition · Non-Holo/);
    assert.equal(pack.itemSpecifics.Edition, "1st Edition");
    assert.equal(pack.itemSpecifics.Finish, "Non-Holo");
    assert.match(buildListingPackCsv([input]), /1st Edition.*Non-Holo/);
  }
});

test("finish is explicit for raw cards and slabs, with no foil fallback", () => {
  for (const [finish, expected] of [["NORMAL", "Non-Holo"], ["HOLO", "Holo"], ["REVERSE_HOLO", "Reverse Holo"]]) {
    for (const input of [moonbreon, slab]) {
      const pack = buildListingPack({ ...input, card: { ...input.card, finish } });
      assert.equal(pack.itemSpecifics.Finish, expected);
      assert.match(pack.description, new RegExp(`Printing: ${expected}`));
      assert.equal(pack.itemSpecifics.Features, undefined);
    }
  }
});

test("long eBay titles retain recorded printing and canonical half grades", () => {
  const pack = buildListingPack({
    ...slab,
    grade: "BGS_9_5",
    card: { ...slab.card, name: "Charizard Very Long Collector Card Name", edition: "FIRST_EDITION", finish: "REVERSE_HOLO" },
  });
  assert.ok(pack.title.length <= 80);
  assert.match(pack.title, /199\/165 1st Edition Reverse Holo BGS 9\.5 GEM MINT/);
  assert.equal(pack.itemSpecifics.Grade, "9.5");
  assert.doesNotMatch(pack.copyReady, /not reholdered/i);
});

test("raw condition classification requires an unambiguous recorded bucket", () => {
  assert.equal(normalizeListingRawCondition(" dmg "), "DMG");
  assert.equal(normalizeListingRawCondition("Near Mint"), "NM");
  assert.equal(normalizeListingRawCondition("Lightly Played"), "LP");
  for (const condition of [undefined, null, "", "unknown", "not near mint", "NM / LP", "NM with a crease"]) {
    assert.equal(normalizeListingRawCondition(condition), null, String(condition));
  }
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
  assert.equal(cardmarketConditionCode("HP"), "PL");
  assert.equal(cardmarketConditionCode("DMG"), "PO");
  assert.equal(cardmarketConditionCode(undefined), "Review required");
  assert.equal(cardmarketConditionCode("not near mint"), "Review required");
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
  assert.match(lines[0]!, /^Action\(SiteID=UK\|Country=GB\|Currency=GBP\|Version=1193\),CustomLabel,Category,Title/);
  assert.match(lines[0]!, /StartPrice/);
  assert.match(lines[1]!, /"Pikachu ""Promo""/);
  assert.match(lines[1]!, /"Scarlet, Violet Promos/);
  assert.match(lines[2]!, /Charizard ex/);
});

const EBAY_ACTION = "Action(SiteID=UK|Country=GB|Currency=GBP|Version=1193)";
const EBAY_SELLER_HUB_HEADER = [
  EBAY_ACTION,
  "CustomLabel",
  "Category",
  "Title",
  "Description",
  "ConditionID",
  "CD:27501",
  "CD:27502",
  "CDA:27503",
  "CD:40001",
  "Quantity",
  "Format",
  "Duration",
  "StartPrice",
  "PostageService-1:Option",
  "PostageService-1:Cost",
  "DispatchTimeMax",
  "ReturnsAcceptedOption",
  "C:Game",
  "C:Card Name",
  "C:Set",
  "C:Card Number",
  "C:Language",
  "C:Rarity",
  "C:Edition",
  "C:Finish",
].join(",");

test("default and explicit eBay CSVs use the Seller Hub File Exchange schema", () => {
  assert.equal(listingPackCsvHeader(), EBAY_SELLER_HUB_HEADER);
  assert.equal(listingPackCsvHeader("EBAY"), EBAY_SELLER_HUB_HEADER);
  assert.equal(buildListingPackCsv([]), EBAY_SELLER_HUB_HEADER);

  const implicit = buildListingPackCsv([moonbreon]);
  const explicit = buildListingPackCsv([{ ...moonbreon, channel: "EBAY" }]);
  assert.equal(implicit, explicit);
  const row = csvRecord(explicit);
  assert.deepEqual(
    {
      action: row[EBAY_ACTION],
      category: row.Category,
      format: row.Format,
      duration: row.Duration,
      startPrice: row.StartPrice,
      postage: row["PostageService-1:Option"],
      conditionId: row.ConditionID,
      cardCondition: row["CD:40001"],
      game: row["C:Game"],
    },
    {
      action: "Add",
      category: "183454",
      format: "FixedPrice",
      duration: "GTC",
      startPrice: "285.00",
      postage: "UK_RoyalMailFirstClassStandard",
      conditionId: "4000",
      cardCondition: "400010",
      game: "Pokémon TCG",
    },
  );
  assert.equal(parseCsvLine(explicit.split("\n")[1]!).length, EBAY_SELLER_HUB_HEADER.split(",").length);
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

const pricedRaw = { ...moonbreon, listPricePence: 2500 };

function ebayDescriptorCell(descriptors: EbayConditionDescriptor[] | undefined, name: string): string {
  const match = descriptors?.find((descriptor) => descriptor.name === name);
  if (!match) return "";
  return match.additionalInfo ?? match.values?.[0] ?? "";
}

test("eBay CSV lists a raw NM single with category 183454 descriptors", () => {
  const input = { ...pricedRaw, condition: "NM" };
  const row = csvRecord(buildListingPackCsv([input]));
  assert.equal(row[EBAY_ACTION], "Add");
  assert.equal(ebayCsvRowAction(input), "Add");
  assert.equal(row.ConditionID, "4000");
  assert.equal(row["CD:40001"], "400010");
  assert.equal(row["CD:27501"], "");
  assert.equal(row["CD:27502"], "");
  assert.equal(row["CDA:27503"], "");
  assert.equal(row.Duration, "GTC");
  assert.equal(row.Category, "183454");
  assert.equal(row.StartPrice, "25.00");
});

test("eBay CSV maps raw conditions onto the four 183454 card-condition IDs", () => {
  for (const [condition, cardConditionId] of [
    ["NM", "400010"],
    ["LP", "400015"],
    ["MP", "400016"],
    ["HP", "400017"],
    ["DMG", "400017"],
    ["Near Mint", "400010"],
    ["Damaged", "400017"],
  ] as const) {
    const row = csvRecord(buildListingPackCsv([{ ...pricedRaw, condition }]));
    assert.equal(row[EBAY_ACTION], "Add", condition);
    assert.equal(row.ConditionID, "4000", condition);
    assert.equal(row["CD:40001"], cardConditionId, condition);
    assert.equal(row["CD:27501"], "", condition);
    assert.equal(row["CD:27502"], "", condition);
    assert.equal(row["CDA:27503"], "", condition);
  }
});

test("eBay CSV writes graded descriptors and leaves the ungraded column blank", () => {
  const psa10 = { ...slab, listPricePence: 5000, certNumber: "12345", grade: "PSA_10" };
  const psaRow = csvRecord(buildListingPackCsv([psa10]));
  assert.equal(psaRow[EBAY_ACTION], "Add");
  assert.equal(psaRow.ConditionID, "2750");
  assert.equal(psaRow["CD:27501"], "275010");
  assert.equal(psaRow["CD:27502"], "275020");
  assert.equal(psaRow["CDA:27503"], "12345");
  assert.equal(psaRow["CD:40001"], "");

  const psa95 = csvRecord(buildListingPackCsv([{ ...psa10, grade: "PSA_9_5" }]));
  assert.equal(psa95.ConditionID, "2750");
  assert.equal(psa95["CD:27501"], "275010");
  assert.equal(psa95["CD:27502"], "275021");
  assert.equal(psa95["CD:40001"], "");

  const ace = csvRecord(buildListingPackCsv([{ ...psa10, grade: "ACE_10" }]));
  assert.equal(ace["CD:27501"], "2750119");
  assert.equal(ace["CD:27502"], "275020");

  const unknown = csvRecord(buildListingPackCsv([{ ...psa10, grade: "XYZ_9" }]));
  assert.equal(unknown[EBAY_ACTION], "Add");
  assert.equal(unknown.ConditionID, "2750");
  assert.equal(unknown["CD:27501"], "2750123");
  assert.equal(unknown["CD:27502"], "275022");
  assert.equal(unknown["CDA:27503"], "12345");
  assert.equal(unknown["CD:40001"], "");
});

test("eBay CSV descriptors match the inventory payload for the same fixtures", () => {
  const fixtures: ListingPackInput[] = [
    { ...pricedRaw, condition: "NM" },
    { ...pricedRaw, condition: "LP" },
    { ...pricedRaw, condition: "MP" },
    { ...pricedRaw, condition: "HP" },
    { ...pricedRaw, condition: "DMG" },
    { ...pricedRaw, condition: "Near Mint" },
    { ...pricedRaw, condition: "Damaged" },
    { ...slab, listPricePence: 5000, certNumber: "12345", grade: "PSA_10" },
    { ...slab, listPricePence: 5000, certNumber: "12345", grade: "PSA_9_5" },
    { ...slab, listPricePence: 5000, certNumber: "12345", grade: "ACE_10" },
    { ...slab, listPricePence: 5000, certNumber: "12345", grade: "XYZ_9" },
  ];
  for (const input of fixtures) {
    const label = `${input.grade}/${String(input.condition ?? "")}`;
    const row = csvRecord(buildListingPackCsv([input]));
    const payload = buildInventoryItemPayload(input, 1);
    assert.equal(row[EBAY_ACTION], "Add", label);
    assert.equal(row.ConditionID, payload.condition === "LIKE_NEW" ? "2750" : "4000", label);
    assert.equal(row["CD:27501"], ebayDescriptorCell(payload.conditionDescriptors, "27501"), label);
    assert.equal(row["CD:27502"], ebayDescriptorCell(payload.conditionDescriptors, "27502"), label);
    assert.equal(row["CDA:27503"], ebayDescriptorCell(payload.conditionDescriptors, "27503"), label);
    assert.equal(row["CD:40001"], ebayDescriptorCell(payload.conditionDescriptors, "40001"), label);
  }
});

test("unlistable eBay rows stay in the file as drafts instead of being dropped", () => {
  const priced = { ...moonbreon, listPricePence: 1200, condition: "NM" };
  const drafts = [
    { ...priced, condition: null },
    { ...priced, condition: "" },
    { ...priced, condition: "Played-ish" },
    { ...priced, grade: "PSA_11", certNumber: "999" },
    { card: moonbreon.card, grade: "RAW", condition: "NM" },
  ];
  const inputs = [{ ...priced, condition: "LP" }, ...drafts];
  const csv = buildListingPackCsv(inputs);
  assert.equal(csv.split("\n").length, inputs.length + 1);
  assert.equal(csvRecord(csv, 1)[EBAY_ACTION], "Add");
  assert.equal(csvRecord(csv, 1).ConditionID, "4000");

  drafts.forEach((input, index) => {
    const row = csvRecord(csv, index + 2);
    const label = `${input.grade}/${String(input.condition)}`;
    assert.equal(row[EBAY_ACTION], "Draft", label);
    assert.equal(ebayCsvRowAction(input), "Draft", label);
    assert.equal(row.ConditionID, "", label);
    assert.equal(row["CD:27501"], "", label);
    assert.equal(row["CD:27502"], "", label);
    assert.equal(row["CDA:27503"], "", label);
    assert.equal(row["CD:40001"], "", label);
    assert.equal(buildListingPackCsv([input]).split("\n").length, 2, label);
  });

  assert.equal(csvRecord(csv, 2).StartPrice, "12.00");
  assert.equal(csvRecord(csv, 3).StartPrice, "12.00");
  assert.equal(csvRecord(csv, 4).StartPrice, "12.00");
  assert.equal(csvRecord(csv, 5).StartPrice, "12.00");
  assert.equal(csvRecord(csv, 6).StartPrice, "");
});

test("eBay item specifics use C: columns from the listing pack and omit grader columns", () => {
  const header = listingPackCsvHeader().split(",");
  for (const column of header) {
    assert.equal(column.startsWith("ItemSpecifics:"), false, column);
  }
  assert.equal(header.includes("C:Professional Grader"), false);
  assert.equal(header.includes("C:Grade"), false);
  assert.equal(header.includes("C:Card Condition"), false);

  const printed = {
    ...slab,
    card: { ...slab.card, edition: "FIRST_EDITION", finish: "HOLO", language: "JP" },
  };
  const specifics = buildItemSpecifics(printed);
  const row = csvRecord(buildListingPackCsv([printed]));
  for (const key of ["Game", "Card Name", "Set", "Card Number", "Language", "Rarity", "Edition", "Finish"]) {
    assert.equal(row[`C:${key}`], specifics[key] ?? "", key);
  }
  assert.equal(row["C:Game"], "Pokémon TCG");
  assert.equal(row["C:Language"], "JP");
  assert.equal(row["C:Edition"], "1st Edition");
  assert.equal(row["C:Finish"], "Holo");
  assert.equal(row["C:Professional Grader"], undefined);
  assert.equal(specifics["Professional Grader"], "PSA");
  assert.equal(row["CD:27501"], "275010");
});

test("eBay CSV titles with a comma, quote and accent round-trip through csvRecord", () => {
  const input = {
    card: { name: 'Éclair "Promo", 1', language: "EN" },
    grade: "RAW",
    condition: "NM",
    listPricePence: 500,
  };
  const title = buildEbayTitle(input);
  assert.match(title, /Éclair "Promo", 1/);
  const row = csvRecord(buildListingPackCsv([input]));
  assert.equal(row.Title, title);
  assert.equal(row["C:Card Name"], 'Éclair "Promo", 1');
});

test("eBay listing-pack export counts draft rows and stays read-only", async () => {
  const savedUrl = process.env.DATABASE_URL;
  const globalPrisma = globalThis as { prisma?: unknown };
  const previousPrisma = globalPrisma.prisma;
  const rows = [
    {
      cardId: "card-nm",
      grade: "RAW",
      costBasis: 1000,
      condition: "NM",
      graderCert: null,
      card: { name: "Pikachu", setName: "Base", number: "58/102", rarity: "Common", language: "EN", edition: null, finish: null },
      listings: [],
    },
    {
      cardId: "card-raw",
      grade: "RAW",
      costBasis: 1000,
      condition: null,
      graderCert: null,
      card: { name: "Bulbasaur", setName: "Base", number: "44/102", rarity: "Common", language: "EN", edition: null, finish: null },
      listings: [],
    },
  ];
  let current = rows;
  globalPrisma.prisma = {
    inventoryItem: { findMany: async () => current },
    priceSnapshot: { findMany: async () => [] },
    compResult: { findMany: async () => [] },
  };
  process.env.DATABASE_URL = savedUrl || "postgresql://example.invalid/poke-deal";

  try {
    const ebay = await listingPackExportGET(new Request("http://localhost/api/export/listing-pack"));
    assert.equal(ebay.status, 200);
    assert.equal(ebay.headers.get("X-Listing-Pack-Drafts"), "1");
    const ebayCsv = await ebay.text();
    assert.equal(ebayCsv.split("\n").length, 3);
    assert.equal(csvRecord(ebayCsv, 1)[EBAY_ACTION], "Add");
    assert.equal(csvRecord(ebayCsv, 1).ConditionID, "4000");
    assert.equal(csvRecord(ebayCsv, 2)[EBAY_ACTION], "Draft");
    assert.equal(csvRecord(ebayCsv, 2).ConditionID, "");

    current = [];
    const empty = await listingPackExportGET(new Request("http://localhost/api/export/listing-pack?channel=EBAY"));
    assert.equal(empty.headers.get("X-Listing-Pack-Drafts"), "0");
    assert.equal(await empty.text(), listingPackCsvHeader("EBAY"));

    current = rows;
    const cardmarket = await listingPackExportGET(new Request("http://localhost/api/export/listing-pack?channel=CARDMARKET"));
    assert.equal(cardmarket.headers.get("X-Listing-Pack-Drafts"), null);
    assert.equal(cardmarket.status, 200);
    assert.match(await cardmarket.text(), /^Card Name,Expansion,/);
  } finally {
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
    if (previousPrisma === undefined) delete globalPrisma.prisma;
    else globalPrisma.prisma = previousPrisma;
  }
});
