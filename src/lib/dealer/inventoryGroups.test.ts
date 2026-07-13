import assert from "node:assert/strict";
import test from "node:test";
import { groupInventoryHoldings } from "./inventoryGroups.js";

test("groups identical card and grade into cost lots", () => {
  const groups = groupInventoryHoldings([
    { id: "a", grade: "RAW", quantity: 1, costBasis: 1000, card: { id: "gengar", name: "Gengar" } },
    { id: "b", grade: "RAW", quantity: 2, costBasis: 1300, card: { id: "gengar", name: "Gengar" } },
    { id: "c", grade: "PSA_10", quantity: 1, costBasis: 9000, card: { id: "gengar", name: "Gengar" } },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.items.length, 2);
  assert.equal(groups[0]?.quantity, 3);
  assert.equal(groups[0]?.averageUnitCostPence, 1200);
});
