import assert from "node:assert/strict";
import test from "node:test";
import { lockInventoryItemForSale, type SaleLockDb } from "./saleTransaction.js";

test("sale transaction acquires a parameterized row lock before quantity planning", async () => {
  let sql = "";
  let values: unknown[] = [];
  const db: SaleLockDb = {
    async $queryRaw(strings, ...input) {
      sql = strings.join("?");
      values = input;
      return [{ id: "item-1" }] as any;
    },
  };
  assert.equal(await lockInventoryItemForSale(db, "item-1"), true);
  assert.match(sql, /InventoryItem/);
  assert.match(sql, /FOR UPDATE/i);
  assert.deepEqual(values, ["item-1"]);
  assert.equal(sql.includes("item-1"), false, "id must stay a query parameter");
});
