import assert from "node:assert/strict";
import test from "node:test";
import { availableOfflineSaleQuantity, type OfflineSaleReservation } from "./pendingSales.js";

const stock = { id: "single", quantity: 3, status: "IN_STOCK", updatedAt: "2026-09-04T12:00:00.000Z" };
const sale = (id: string, quantity: number): OfflineSaleReservation => ({ id, kind: "mark-sold", endpoint: "/api/inventory/single/sell", body: { quantity } });

test("queued sales reserve copies immediately and do not reserve unrelated stock", () => {
  assert.equal(availableOfflineSaleQuantity(stock, [sale("one", 2)]), 1);
  assert.equal(availableOfflineSaleQuantity(stock, [sale("one", 2), sale("two", 1)]), 0);
  assert.equal(availableOfflineSaleQuantity({ ...stock, id: "other" }, [sale("one", 2)]), 3);
  assert.equal(availableOfflineSaleQuantity(stock, []), 3);
});

test("synced acknowledgements keep stale tabs and bootstrap from reopening the last copy", () => {
  const acknowledged = {
    ...sale("one", 3), syncedAt: "2026-09-04T12:01:01.000Z",
    stockAfterSync: { ...stock, status: "SOLD", updatedAt: "2026-09-04T12:01:00.000Z" },
  };
  assert.equal(availableOfflineSaleQuantity(stock, [acknowledged]), 0);
  assert.equal(availableOfflineSaleQuantity({ ...stock, updatedAt: undefined }, [acknowledged]), 0);
  assert.equal(availableOfflineSaleQuantity(acknowledged.stockAfterSync, [acknowledged]), 0);
});

test("fresh confirmed stock is not reduced twice and a later genuine restock can be sold", () => {
  const confirmedStock = { ...stock, quantity: 1, updatedAt: "2026-09-04T12:01:00.000Z" };
  const acknowledged = { ...sale("one", 2), syncedAt: "2026-09-04T12:01:01.000Z", stockAfterSync: confirmedStock };
  assert.equal(availableOfflineSaleQuantity(stock, [acknowledged]), 1);
  assert.equal(availableOfflineSaleQuantity(confirmedStock, [acknowledged]), 1);
  assert.equal(availableOfflineSaleQuantity(stock, [acknowledged, sale("two", 1)]), 0);
  assert.equal(availableOfflineSaleQuantity({ ...stock, quantity: 4, updatedAt: "2026-09-04T13:00:00.000Z" }, [acknowledged]), 4);
});

test("acknowledgements use server stock version rather than arrival order", () => {
  const older = { ...sale("old", 1), syncedAt: "2026-09-04T12:03:00.000Z", stockAfterSync: { ...stock, quantity: 2, updatedAt: "2026-09-04T12:01:00.000Z" } };
  const newer = { ...sale("new", 1), syncedAt: "2026-09-04T12:02:00.000Z", stockAfterSync: { ...stock, quantity: 1, updatedAt: "2026-09-04T12:02:00.000Z" } };
  assert.equal(availableOfflineSaleQuantity(stock, [older, newer]), 1);
  assert.equal(availableOfflineSaleQuantity(stock, [newer, older]), 1);
});

test("uncertain success and malformed legacy quantities keep availability conservative", () => {
  assert.equal(availableOfflineSaleQuantity(stock, [{ ...sale("one", 3), syncedAt: "2026-09-04T12:01:00Z" }]), 0);
  assert.equal(availableOfflineSaleQuantity(stock, [sale("one", NaN)]), 0);
  assert.equal(availableOfflineSaleQuantity({ ...stock, status: "SOLD" }, []), 0);
});
