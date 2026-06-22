import assert from "node:assert/strict";
import test from "node:test";

import { buildInventoryView, buildListingView, gradeRank } from "./tableControls.js";

const inventory = [
  {
    id: "raw-zard",
    card: { name: "Charizard ex", setName: "151", number: "199/165" },
    grade: "RAW",
    costBasis: 1800,
    status: "IN_STOCK",
    createdAt: "2026-06-22T10:00:00.000Z",
    acquiredFrom: "Card fair",
    location: "Box A",
  },
  {
    id: "psa-pika",
    card: { name: "Pikachu ex", setName: "Surging Sparks", number: "238/191" },
    grade: "PSA_10",
    costBasis: 22000,
    status: "LISTED",
    createdAt: "2026-06-20T10:00:00.000Z",
    acquiredFrom: "Trade",
    location: "Slab case",
  },
  {
    id: "bgs-mew",
    card: { name: "Mew ex", setName: "Paldean Fates", number: "232/091" },
    grade: "BGS_9_5",
    costBasis: 11500,
    status: "RESERVED",
    createdAt: "2026-06-21T10:00:00.000Z",
    acquiredFrom: "Whatnot",
    location: "Box B",
  },
];

const listings = [
  {
    id: "draft-zard",
    channel: "EBAY",
    state: "DRAFT",
    title: "Charizard ex 199/165 RAW",
    suggestedPrice: 3099,
    listPrice: null,
    createdAt: "2026-06-22T10:00:00.000Z",
    item: inventory[0],
  },
  {
    id: "active-pika",
    channel: "VINTED",
    state: "ACTIVE",
    title: "Pikachu ex PSA 10",
    suggestedPrice: 26000,
    listPrice: 28000,
    createdAt: "2026-06-20T10:00:00.000Z",
    item: inventory[1],
  },
  {
    id: "ended-mew",
    channel: "CARDMARKET",
    state: "ENDED",
    title: null,
    suggestedPrice: 14000,
    listPrice: 13500,
    createdAt: "2026-06-21T10:00:00.000Z",
    item: inventory[2],
  },
];

test("buildInventoryView searches across card, set, grade and location", () => {
  assert.deepEqual(
    buildInventoryView(inventory, { query: "psa slab", sort: "newest" }).map((row) => row.id),
    ["psa-pika"],
  );
  assert.deepEqual(
    buildInventoryView(inventory, { query: "151 199", sort: "newest" }).map((row) => row.id),
    ["raw-zard"],
  );
});

test("buildInventoryView sorts stock by dealer-useful fields", () => {
  assert.deepEqual(
    buildInventoryView(inventory, { query: "", sort: "highest-cost" }).map((row) => row.id),
    ["psa-pika", "bgs-mew", "raw-zard"],
  );
  assert.deepEqual(
    buildInventoryView(inventory, { query: "", sort: "oldest" }).map((row) => row.id),
    ["psa-pika", "bgs-mew", "raw-zard"],
  );
});

test("buildListingView filters state and searches linked card context", () => {
  assert.deepEqual(
    buildListingView(listings, { query: "surging psa", state: "ACTIVE", sort: "newest" }).map((row) => row.id),
    ["active-pika"],
  );
  assert.deepEqual(
    buildListingView(listings, { query: "mew", state: "ALL", sort: "newest" }).map((row) => row.id),
    ["ended-mew"],
  );
});

test("buildListingView sorts by current list price", () => {
  assert.deepEqual(
    buildListingView(listings, { query: "", state: "ALL", sort: "highest-price" }).map((row) => row.id),
    ["active-pika", "ended-mew", "draft-zard"],
  );
});

test("gradeRank keeps slab grades above raw for sort order", () => {
  assert.equal(gradeRank("RAW") < gradeRank("CGC_10"), true);
  assert.equal(gradeRank("BGS_9_5") < gradeRank("PSA_10"), true);
});
