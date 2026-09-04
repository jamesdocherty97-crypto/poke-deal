import { test } from "node:test";
import assert from "node:assert/strict";
import { canUndoSale, exactItemRevenue, inventoryLedgerGuard, parseConfirmedPounds, planSaleAmountRevision, saleAmountsPatchSchema, saleLedgerEvidence } from "./saleLedger.js";

const sale = { salePrice: 5175, fees: 680, postage: 175, costBasis: 2000, itemRevenue: 5000, costsEstimated: true };

test("financial forms parse exact pence and reject blanks, extra decimals and scientific notation", () => {
  assert.equal(parseConfirmedPounds("19.99", "Fees"), 1999);
  assert.equal(parseConfirmedPounds("0", "Fees"), 0);
  assert.equal(parseConfirmedPounds(" 1.2 ", "Fees"), 120);
  for (const input of ["", " ", "1.999", "-1", "2e2", "1,000", "21474836.48"]) {
    assert.throws(() => parseConfirmedPounds(input, "Fees"), /Fees:/);
  }
});

test("sale cost snapshot stays fixed after inventory costs change; legacy fallback is explicitly provisional", () => {
  assert.equal(saleLedgerEvidence(sale, 9999).costBasisPence, 2000);
  assert.equal(saleLedgerEvidence(sale, 9999).costBasisEstimated, false);
  assert.equal(saleLedgerEvidence(sale, 9999).costsEstimated, true);
  const legacy = saleLedgerEvidence({ ...sale, costBasis: null, costsEstimated: null }, 9999);
  assert.equal(legacy.costBasisPence, 9999);
  assert.equal(legacy.costBasisEstimated, true);
  assert.equal(legacy.costsEstimated, true);
});

test("actual costs save preserves original amounts and prior correction history", () => {
  const patch = { feesPence: 700, postagePence: 180, costBasisPence: 2100, itemRevenuePence: 5000, reason: "Checked actual marketplace fees and receipt" };
  const first = planSaleAmountRevision(sale, patch, new Date("2026-09-04T10:00:00Z"))!;
  assert.equal(first.costsEstimated, false);
  assert.equal(first.costBasis, 2100);
  assert.deepEqual(first.amountRevisions[0].before, { fees: 680, postage: 175, costBasis: 2000, itemRevenue: 5000, costsEstimated: true });
  assert.equal(first.amountRevisions[0].reason, patch.reason);
  assert.equal(first.amountRevisions[0].changedAt, "2026-09-04T10:00:00.000Z");
  assert.equal(sale.fees, 680);
  assert.equal(planSaleAmountRevision({ ...sale, ...first }, patch), null, "response retry does not duplicate history");
  const second = planSaleAmountRevision({ ...sale, ...first }, { ...patch, feesPence: 690, reason: "Corrected the fee receipt transcription" })!;
  assert.equal(second.amountRevisions.length, 2);
  assert.deepEqual(second.amountRevisions[0], first.amountRevisions[0]);
  assert.equal(second.amountRevisions[1].before.fees, 700);
});

test("confirming fees does not silently confirm historical purchase costs or unknown item revenue", () => {
  const revision = planSaleAmountRevision({ ...sale, costBasis: null, itemRevenue: null, costsEstimated: null }, { feesPence: 700, postagePence: 200, reason: "Confirmed receipt" })!;
  assert.equal(revision.costBasis, null);
  assert.equal(revision.itemRevenue, null);
  assert.equal(revision.costsEstimated, false);
  assert.equal(saleLedgerEvidence({ ...sale, ...revision }, 900).costBasisEstimated, true);
});

test("amendments reject blank, fractional, negative, overflowing and fabricated item amounts", () => {
  const patch = { feesPence: 680, postagePence: 175, reason: "Receipt checked" };
  for (const invalid of ["", "0", -1, 0.5, 2_147_483_648, null]) {
    assert.equal(saleAmountsPatchSchema.safeParse({ ...patch, feesPence: invalid }).success, false);
  }
  assert.equal(saleAmountsPatchSchema.safeParse({ ...patch, reason: " " }).success, false);
  assert.equal(saleAmountsPatchSchema.safeParse({ ...patch, salePricePence: 9000 }).success, false, "buyer payment cannot be rewritten");
  assert.throws(() => planSaleAmountRevision(sale, { ...patch, itemRevenuePence: 5176 }), /cannot exceed/);
});

test("item revenue is unknown without explicit shipping, and shipping is bounded", () => {
  assert.equal(exactItemRevenue(5175), null);
  assert.equal(exactItemRevenue(5175, 175), 5000);
  assert.equal(exactItemRevenue(5175, 0), 5175);
  assert.throws(() => exactItemRevenue(100, 101), /cannot exceed/);
});

test("inventory safeguards preserve sale history and unverified historical cost", () => {
  assert.match(inventoryLedgerGuard({ saleCount: 1, deleting: true })!, /cannot be deleted/);
  assert.match(inventoryLedgerGuard({ saleCount: 0, deleting: true, exposedListingCount: 1 })!, /external listings/);
  assert.match(inventoryLedgerGuard({ saleCount: 1, legacySaleCount: 1, changingCost: true })!, /historical acquisition cost/);
  assert.match(inventoryLedgerGuard({ saleCount: 1, changingIdentity: true })!, /physical copy/);
  assert.match(inventoryLedgerGuard({ saleCount: 0, changingSoldStatus: true })!, /Editing stock cannot/);
  assert.match(inventoryLedgerGuard({ saleCount: 1, changingSoldQuantity: true })!, /Editing stock cannot/);
  assert.equal(inventoryLedgerGuard({ saleCount: 1, legacySaleCount: 0, changingCost: true }), null);
  assert.equal(inventoryLedgerGuard({ saleCount: 0, deleting: true }), null);
});

test("undo recording mistakes cannot erase historical, imported or reconciled sales", () => {
  assert.equal(canUndoSale(sale), true);
  assert.equal(canUndoSale({ ...sale, costBasis: null }), false);
  assert.equal(canUndoSale({ ...sale, ebayOrderImport: { id: "import" } }), false);
  assert.equal(canUndoSale({ ...sale, clientMutationId: "ebay-order:order-1" }), false);
  assert.equal(canUndoSale({ ...sale, amountRevisions: [{ before: {} }] }), false);
});
