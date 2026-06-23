import { test } from "node:test";
import assert from "node:assert/strict";
import { booksToCsv, escapeCsvCell, expensesToCsv, listingsToCsv } from "./csv.js";

test("escapeCsvCell quotes commas, quotes and newlines", () => {
  assert.equal(escapeCsvCell("plain"), "plain");
  assert.equal(escapeCsvCell("Charizard, ex"), '"Charizard, ex"');
  assert.equal(escapeCsvCell('say "mint"'), '"say ""mint"""');
  assert.equal(escapeCsvCell("line\nbreak"), '"line\nbreak"');
});

test("listingsToCsv exports GBP listing rows for manual channels", () => {
  const csv = listingsToCsv([
    {
      id: "listing_1",
      channel: "VINTED",
      state: "DRAFT",
      title: null,
      suggestedPrice: 30906,
      listPrice: null,
      externalRef: null,
      externalUrl: null,
      createdAt: new Date("2026-06-22T09:00:00.000Z"),
      listedAt: null,
      endedAt: null,
      item: {
        id: "item_1",
        grade: "RAW",
        quantity: 1,
        costBasis: 1800,
        acquiredFrom: "Card fair",
        acquiredAt: new Date("2026-06-22T08:00:00.000Z"),
        location: "Box A",
        status: "IN_STOCK",
        card: {
          name: "Charizard ex",
          setName: "151",
          number: "199/165",
          rarity: "Special Illustration Rare",
          tcgApiId: "sv3pt5-199",
        },
      },
    },
  ]);

  assert.match(csv, /^channel,state,title,card_name/);
  assert.match(csv, /VINTED,DRAFT,Charizard ex 199\/165,Charizard ex,151,199\/165,RAW,1,GBP,,309\.06,18\.00/);
});

test("booksToCsv exports realized profit and margin in GBP", () => {
  const csv = booksToCsv([
    {
      id: "sale_1",
      channel: "EBAY",
      salePrice: 5000,
      fees: 650,
      postage: 120,
      soldAt: new Date("2026-06-22T10:00:00.000Z"),
      item: {
        id: "item_1",
        grade: "RAW",
        quantity: 3,
        costBasis: 1800,
        acquiredFrom: "Card fair",
        acquiredAt: new Date("2026-06-22T08:00:00.000Z"),
        card: {
          name: "Charizard ex",
          setName: "151",
          number: "199/165",
          rarity: "Special Illustration Rare",
          tcgApiId: "sv3pt5-199",
        },
      },
    },
  ]);

  assert.match(csv, /^sold_at,channel,card_name/);
  assert.match(csv, /2026-06-22T10:00:00\.000Z,EBAY,Charizard ex,151,199\/165,RAW,1,GBP,50\.00,6\.50,1\.20,18\.00,24\.30,48\.6/);
});

test("expensesToCsv exports operating costs in GBP", () => {
  const csv = expensesToCsv([
    {
      id: "expense_1",
      category: "TABLE_FEE",
      description: "Card fair table",
      amount: 1500,
      spentAt: new Date("2026-06-23T08:30:00.000Z"),
      channel: "IN_PERSON",
      source: "Local fair",
      notes: "Sunday pitch",
      createdAt: new Date("2026-06-23T09:00:00.000Z"),
    },
  ]);

  assert.match(csv, /^spent_at,category,description,currency,amount_gbp/);
  assert.match(csv, /2026-06-23T08:30:00\.000Z,TABLE_FEE,Card fair table,GBP,15\.00,IN_PERSON,Local fair,Sunday pitch/);
});
