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

test("parseStockImportText accepts ACE slabs", () => {
  const parsed = parseStockImportText("Charizard,151,199/165,ACE10,120.00,1,Card fair,Slabs");

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0]?.grade, "ACE_10");
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
