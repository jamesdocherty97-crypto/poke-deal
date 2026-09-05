import test from "node:test";
import assert from "node:assert/strict";
import { createStockImportBatch, parseStockImportBatch, runStockImportBatch, importBatchProgress, type StockImportBatch } from "./stockImportBatch.js";

function batch() {
  return createStockImportBatch("review fixture", Array.from({ length: 20 }, (_, i) => ({
    card: { name: `Card ${i}` }, grade: "RAW" as const, condition: "LP", quantity: 1, costBasisPence: 500,
  })), { channel: "EBAY" }, "fixture-batch-0001");
}

test("interrupted import resumes without repeating confirmed stock or drafts", async () => {
  let saved = batch();
  const stock = new Set<string>();
  const drafts = new Set<string>();
  let interrupt = true;
  const deps = {
    save: (value: StockImportBatch) => { saved = parseStockImportBatch(JSON.stringify(value))!; },
    stock: async (row: StockImportBatch["rows"][number]) => {
      if (interrupt && stock.size === 7) { interrupt = false; throw new Error("Connection interrupted"); }
      stock.add(row.mutationId);
      return row.mutationId;
    },
    draft: async (row: StockImportBatch["rows"][number]) => { drafts.add(row.mutationId); return `listing:${row.mutationId}`; },
  };
  await assert.rejects(runStockImportBatch(saved, deps), /interrupted/);
  assert.equal(importBatchProgress(saved).stocked, 7);
  await runStockImportBatch(saved, deps);
  await runStockImportBatch(saved, deps);
  assert.equal(stock.size, 20);
  assert.equal(drafts.size, 20);
  assert.equal(importBatchProgress(saved).complete, true);
});

test("lost write acknowledgements reuse the same durable mutation identifiers", async () => {
  let saved = batch();
  const ids = new Set<string>();
  let drop = true;
  const deps = {
    save: (value: StockImportBatch) => { saved = parseStockImportBatch(JSON.stringify(value))!; },
    stock: async (row: StockImportBatch["rows"][number]) => {
      ids.add(row.mutationId);
      if (drop) { drop = false; throw new Error("Lost response after commit"); }
      return row.mutationId;
    },
    draft: async (row: StockImportBatch["rows"][number]) => `listing:${row.mutationId}`,
  };
  await assert.rejects(runStockImportBatch(saved, deps));
  await runStockImportBatch(saved, deps);
  assert.equal(ids.size, 20);
});

test("failed local persistence prevents the first remote write", async () => {
  let writes = 0;
  await assert.rejects(runStockImportBatch(batch(), {
    save: () => { throw new Error("Storage unavailable"); },
    stock: async () => { writes++; return "item"; },
    draft: async () => { writes++; return "listing"; },
  }));
  assert.equal(writes, 0);
  assert.equal(parseStockImportBatch('{"version":99}'), null);
});

test("import preflight checks eBay's price minimum after resolving row and default channels", () => {
  const row = { card: { name: "Pikachu" }, grade: "RAW" as const, quantity: 1, costBasisPence: 500, listPricePence: 50 };
  assert.throws(() => createStockImportBatch("fixture", [row], { channel: "EBAY" }, "fixture-prices-01"), /Row 1 \(Pikachu\): eBay list price must be at least £0.99/);
  assert.throws(() => createStockImportBatch("fixture", [{ ...row, channel: "EBAY" }], { channel: "VINTED" }, "fixture-prices-01"), /eBay list price/);
  const override = createStockImportBatch("fixture", [{ ...row, channel: "VINTED" }], { channel: "EBAY" }, "fixture-prices-01");
  assert.equal(override.rows[0]?.listPricePence, 50);
  const minimum = createStockImportBatch("fixture", [{ ...row, listPricePence: 99 }], { channel: "EBAY" }, "fixture-prices-01");
  assert.equal(minimum.rows[0]?.listPricePence, 99);
  assert.equal(batch().rows[0]?.listPricePence, undefined);
});

test("invalid values anywhere in an import fail before saving a batch or writing any stock", async () => {
  for (const invalid of ["ebay-minimum", "zero-price", "price-overflow", "cost-overflow", "quantity-overflow"]) {
    const value = batch();
    const last = value.rows[value.rows.length - 1]!;
    if (invalid === "ebay-minimum") last.listPricePence = 50;
    if (invalid === "zero-price") { last.channel = "VINTED"; last.listPricePence = 0; }
    if (invalid === "price-overflow") last.listPricePence = 2_147_483_648;
    if (invalid === "cost-overflow") last.stock.costBasisPence = 2_147_483_648;
    if (invalid === "quantity-overflow") last.stock.quantity = 2_147_483_648;
    let saves = 0;
    let writes = 0;
    await assert.rejects(runStockImportBatch(value, {
      save: () => { saves++; },
      stock: async () => { writes++; return "item"; },
      draft: async () => { writes++; return "listing"; },
    }), /Row 20/, invalid);
    assert.equal(saves, 0, invalid);
    assert.equal(writes, 0, invalid);
  }
});

test("previously saved identifiers remain readable even when a price needs correction", () => {
  const value = batch();
  value.rows[0]!.itemId = "already-stocked";
  value.rows[0]!.listPricePence = 50;
  const restored = parseStockImportBatch(JSON.stringify(value));
  assert.equal(restored?.rows[0]?.itemId, "already-stocked");
  assert.equal(restored?.rows[0]?.mutationId, value.rows[0]!.mutationId);
});
