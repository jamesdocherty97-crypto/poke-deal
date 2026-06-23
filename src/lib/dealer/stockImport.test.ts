import assert from "node:assert/strict";
import test from "node:test";

import { parseStockImportText } from "./stockImport.js";

test("parseStockImportText parses headered stock CSV with listing prices", () => {
  const parsed = parseStockImportText(`card,set,number,grade,cost,qty,source,location,channel,list price,state
Gengar,Lost Origin Trainer Gallery,TG06/TG30,RAW,10.00,2,Card fair,Binder,Vinted,25.00,active
Pikachu ex,Surging Sparks,238/191,PSA 10,200,1,eBay,Slabs,eBay,240,draft`);

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.totalCostPence, 22000);
  assert.equal(parsed.listingCount, 2);
  assert.deepEqual(parsed.rows[0], {
    card: { name: "Gengar", setName: "Lost Origin Trainer Gallery", number: "TG06/TG30" },
    grade: "RAW",
    costBasisPence: 1000,
    quantity: 2,
    acquiredFrom: "Card fair",
    location: "Binder",
    channel: "VINTED",
    listPricePence: 2500,
    listingState: "ACTIVE",
  });
  assert.equal(parsed.rows[1]?.grade, "PSA_10");
  assert.equal(parsed.rows[1]?.channel, "EBAY");
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
