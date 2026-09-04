import assert from "node:assert/strict";
import test from "node:test";

import { parseStockImportText } from "./stockImport.js";

test("parseStockImportText parses headered stock CSV with listing prices", () => {
  const parsed = parseStockImportText(`card,set,number,grade,cost,qty,source,location,condition,cert,channel,list price,state
Gengar,Lost Origin Trainer Gallery,TG06/TG30,RAW,10.00,2,Card fair,Binder,NM,,Vinted,25.00,active
Pikachu ex,Surging Sparks,238/191,PSA 10,200,1,eBay,Slabs,,12345678,eBay,240,draft`);

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.totalCostPence, 22000);
  assert.equal(parsed.totalQuantity, 3);
  assert.equal(parsed.listingCount, 2);
  assert.equal(parsed.explicitListPriceCount, 2);
  assert.deepEqual(parsed.rows[0], {
    card: { name: "Gengar", setName: "Lost Origin Trainer Gallery", number: "TG06/TG30" },
    grade: "RAW",
    costBasisPence: 1000,
    quantity: 2,
    acquiredFrom: "Card fair",
    location: "Binder",
    condition: "NM",
    channel: "VINTED",
    listPricePence: 2500,
    listingState: "ACTIVE",
  });
  assert.equal(parsed.rows[1]?.grade, "PSA_10");
  assert.equal(parsed.rows[1]?.graderCert, "12345678");
  assert.equal(parsed.rows[1]?.channel, "EBAY");
});

test("parseStockImportText accepts ACE, low CGC and BGS half-grade slabs", () => {
  const parsed = parseStockImportText("Charizard,151,199/165,ACE10,120.00,1,Card fair,Slabs");

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0]?.grade, "ACE_10");

  const cgc = parseStockImportText("Lugia,Neo Genesis,,CGC 1.5,80.00,1,Card fair,Slabs");

  assert.equal(cgc.errors.length, 0);
  assert.equal(cgc.rows[0]?.grade, "CGC_1_5");

  const bgs = parseStockImportText("Lugia,Neo Genesis,,BGS 8.5,80.00,1,Card fair,Slabs");

  assert.equal(bgs.errors.length, 0);
  assert.equal(bgs.rows[0]?.grade, "BGS_8_5");
});

test("parseStockImportText keeps slab certs from freeform opening stock", () => {
  const parsed = parseStockImportText("Charizard ex 151 199/165 PSA 10 £700 cert 84213567 slabs list on ebay draft");

  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.rows[0], {
    card: { name: "Charizard ex", setName: "151", number: "199/165" },
    grade: "PSA_10",
    costBasisPence: 70000,
    quantity: 1,
    location: "Slabs",
    graderCert: "84213567",
    channel: "EBAY",
    listingState: "DRAFT",
  });
  assert.equal(parsed.listingCount, 1);
});

test("parseStockImportText keeps old ordered listing rows backward compatible", () => {
  const parsed = parseStockImportText(
    "Gengar,Lost Origin Trainer Gallery,TG06/TG30,RAW,10.00,1,Card fair,Binder,Vinted,25.00",
  );

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0]?.condition, undefined);
  assert.equal(parsed.rows[0]?.graderCert, undefined);
  assert.equal(parsed.rows[0]?.channel, "VINTED");
  assert.equal(parsed.rows[0]?.listPricePence, 2500);
});

test("parseStockImportText parses ordered rows without a header", () => {
  const parsed = parseStockImportText("Charizard,Base,4/102,raw,100.00,1,Collection,Box A");

  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.rows[0], {
    card: { name: "Charizard", setName: "Base", number: "4/102" },
    grade: "RAW",
    costBasisPence: 10000,
    quantity: 1,
    acquiredFrom: "Collection",
    location: "Box A",
  });
});

test("parseStockImportText parses freeform quick-intake rows", () => {
  const parsed = parseStockImportText("Gengar Lost Origin TG06 raw £10");

  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.rows[0], {
    card: { name: "Gengar", setName: "Lost Origin Trainer Gallery", number: "TG06" },
    grade: "RAW",
    costBasisPence: 1000,
    quantity: 1,
  });
  assert.equal(parsed.totalQuantity, 1);
  assert.equal(parsed.listingCount, 1);
  assert.equal(parsed.explicitListPriceCount, 0);
});

test("parseStockImportText keeps freeform dealer context for opening stock", () => {
  const parsed = parseStockImportText("2x Gengar lor tg TG06 raw £10 LP vinted binder list on ebay active");

  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.rows[0], {
    card: { name: "Gengar", setName: "Lost Origin Trainer Gallery", number: "TG06" },
    grade: "RAW",
    costBasisPence: 1000,
    quantity: 2,
    acquiredFrom: "Vinted",
    location: "Binder",
    condition: "LP",
    channel: "EBAY",
    listingState: "ACTIVE",
  });
});

test("parseStockImportText reports line-level errors", () => {
  const parsed = parseStockImportText(`card,set,number,grade,cost
Gengar,Lost Origin Trainer Gallery,TG06,RAW,
Pikachu ex,Surging Sparks,238/191,PSA 11,20`);

  assert.equal(parsed.rows.length, 0);
  assert.deepEqual(parsed.errors, [
    { line: 2, message: "missing cost" },
    { line: 3, message: "unsupported grade" },
  ]);
});

test("parseStockImportText handles quoted commas in card names", () => {
  const parsed = parseStockImportText('card,set,number,grade,cost\n"Boss, Rocket",Team Rocket,15/82,raw,5');

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0]?.card.name, "Boss, Rocket");
});

test("opening-stock CSV preserves acquisition date and exact printing", () => {
  const parsed = parseStockImportText("card,set,number,grade,cost,acquired date,language,edition,finish\nPikachu,Base,58/102,RAW,10,2024-02-29,EN,first edition,reverse holo");
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0]?.acquiredAt, "2024-02-29T12:00:00.000Z");
  assert.deepEqual(parsed.rows[0]?.card, { name: "Pikachu", setName: "Base", number: "58/102", language: "EN", edition: "FIRST_EDITION", finish: "REVERSE_HOLO" });
});

test("opening-stock CSV refuses impossible purchase dates and unknown printings", () => {
  const parsed = parseStockImportText("card,grade,cost,acquired date,finish\nPikachu,RAW,10,2023-02-29,HOLO\nGengar,RAW,15,2024-01-01,rainbow");
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 2);
  assert.match(parsed.errors[0]!.message, /real date/);
  assert.match(parsed.errors[1]!.message, /finish/);
});

test("opening stock rejects unknown or malformed costs instead of inventing a free purchase", () => {
  for (const value of ["unknown", "TBC", "abc", "£", "£1oops", "1.234", "1e3", "-1", "21,474,836.48", "1,23.45"]) {
    const parsed = parseStockImportText(`card,cost\nPikachu,"${value}"`);
    assert.equal(parsed.rows.length, 0, value);
    assert.equal(parsed.errors[0]?.line, 2, value);
    assert.match(parsed.errors[0]!.message, /cost must be a GBP amount/, value);
  }
  assert.equal(parseStockImportText("card,cost\nPikachu,0").rows[0]?.costBasisPence, 0);
});

test("opening stock parses pounds and grouped thousands exactly in CSV and tab-separated rows", () => {
  const csv = parseStockImportText('card,cost,list price\nPikachu,"£1,234.50","£2,345.67"\nGengar,21474836.47,');
  assert.deepEqual(csv.errors, []);
  assert.equal(csv.rows[0]?.costBasisPence, 123450);
  assert.equal(csv.rows[0]?.listPricePence, 234567);
  assert.equal(csv.rows[1]?.costBasisPence, 2_147_483_647);
  assert.equal(csv.rows[1]?.listPricePence, undefined);
  const tsv = parseStockImportText("card\tcost\tlist price\nPikachu\t£ 1,234.50\t£2,345.67");
  assert.deepEqual(tsv.errors, []);
  assert.equal(tsv.rows[0]?.costBasisPence, 123450);
  assert.equal(tsv.rows[0]?.listPricePence, 234567);
});

test("opening stock rejects invalid or zero list prices and quantities that cannot be stored", () => {
  for (const value of ["TBC", "unknown", "1.234", "1e3", "21474836.48", "0"]) {
    const parsed = parseStockImportText(`card,cost,list price\nPikachu,5,${value}`);
    assert.equal(parsed.rows.length, 0, value);
    assert.match(parsed.errors[0]!.message, /list price/, value);
  }
  const parsed = parseStockImportText("card,cost,qty\nPikachu,5,2147483648");
  assert.equal(parsed.rows.length, 0);
  assert.match(parsed.errors[0]!.message, /quantity/);
});

test("freeform opening stock validates the full money token before quick-intake extraction", () => {
  for (const cost of ["£1.234", "cost 1.234", "paid £1.234", "£1e3", "£21474836.48", "total 1.234"]) {
    const parsed = parseStockImportText(`Pikachu raw ${cost}`);
    assert.equal(parsed.rows.length, 0, cost);
    assert.match(parsed.errors[0]!.message, /cost must be a GBP amount/, cost);
  }
  assert.equal(parseStockImportText("Pikachu raw £1.23").rows[0]?.costBasisPence, 123);
});
