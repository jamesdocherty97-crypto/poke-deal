import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOwnedSalesWhere,
  mapOwnedSalesToComp,
  OwnedSalesSource,
  type OwnedSaleRow,
} from "./ownedSales.js";
import type { CardRef } from "../../domain/types.js";

const card: CardRef = {
  name: "Charizard",
  setName: "Base",
  number: "4/102",
  tcgApiId: "base1-4",
  game: "POKEMON",
  language: "EN",
};

const rows: OwnedSaleRow[] = [
  ownedSale("sale_1", 210000, "2026-06-01T12:00:00.000Z"),
  ownedSale("sale_2", 230000, "2026-06-10T12:00:00.000Z"),
  ownedSale("sale_3", 250000, "2026-06-20T12:00:00.000Z"),
];

test("mapOwnedSalesToComp summarizes owned sale prices as GBP comp evidence", () => {
  const comp = mapOwnedSalesToComp(rows, {
    source: "owned-sales",
    card,
    grade: "RAW",
    windowDays: 90,
  });

  assert.equal(comp.source, "owned-sales");
  assert.equal(comp.sampleSize, 3);
  assert.equal(comp.medianPence, 230000);
  assert.equal(comp.lowPence, 210000);
  assert.equal(comp.highPence, 250000);
  assert.equal(comp.asOf, "2026-06-20T12:00:00.000Z");
  assert.equal(comp.card.tcgApiId, "base1-4");
  assert.equal((comp.raw as { kind?: string }).kind, "owned-sales");
});

test("mapOwnedSalesToComp ignores rows for the wrong grade", () => {
  const comp = mapOwnedSalesToComp(
    [...rows, ownedSale("sale_4", 999999, "2026-06-21T12:00:00.000Z", "PSA_10")],
    { source: "owned-sales", card, grade: "RAW", windowDays: 90 },
  );

  assert.equal(comp.sampleSize, 3);
  assert.equal(comp.highPence, 250000);
});

test("OwnedSalesSource degrades to empty comp when the db lookup fails", async () => {
  const source = new OwnedSalesSource({
    sale: {
      async findMany() {
        throw new Error("db offline");
      },
    },
  });

  const comp = await source.lookup(card, { grade: "RAW" });
  assert.equal(comp.sampleSize, 0);
  assert.equal((comp.raw as { reason?: string }).reason, "owned sale lookup failed");
});

test("buildOwnedSalesWhere prefers exact tcgApiId when available", () => {
  const where = buildOwnedSalesWhere(card, "RAW", 90) as {
    item?: { grade?: string; card?: { tcgApiId?: string } };
  };

  assert.equal(where.item?.grade, "RAW");
  assert.equal(where.item?.card?.tcgApiId, "base1-4");
});

function ownedSale(
  id: string,
  salePrice: number,
  soldAt: string,
  grade: "RAW" | "PSA_10" = "RAW",
): OwnedSaleRow {
  return {
    id,
    salePrice,
    fees: 0,
    postage: 0,
    soldAt: new Date(soldAt),
    item: {
      id: `item_${id}`,
      grade,
      costBasis: 100000,
      card: {
        id: "card_1",
        game: "POKEMON",
        language: "EN",
        name: "Charizard",
        setName: "Base",
        setCode: "base1",
        number: "4/102",
        tcgApiId: "base1-4",
      },
    },
  };
}
