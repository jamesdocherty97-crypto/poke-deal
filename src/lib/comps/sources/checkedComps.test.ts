import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CheckedCompsSource,
  buildCheckedCompsWhere,
  checkedCompPlatformRegion,
  mapCheckedCompsToComp,
  normalizeCheckedCompPlatform,
  type CheckedCompRow,
} from "./checkedComps.js";
import type { CardRef, Grade } from "../../domain/types.js";

const card: CardRef = {
  name: "Zapdos ex",
  setName: "Scarlet & Violet 151",
  number: "192/165",
  tcgApiId: "sv3pt5-192",
  game: "POKEMON",
  language: "EN",
};

test("mapCheckedCompsToComp summarizes recent dealer-checked prices", () => {
  const rows = [
    checkedComp("cc_1", 5200, daysAgo(5)),
    checkedComp("cc_2", 5600, daysAgo(2)),
    checkedComp("cc_3", 6000, daysAgo(1), "cardmarket"),
  ];

  const comp = mapCheckedCompsToComp(rows, { source: "checked-comps", card, grade: "RAW", windowDays: 90 });

  assert.equal(comp.source, "checked-comps");
  assert.equal(comp.sampleSize, 3);
  assert.equal(comp.medianPence, 5600);
  assert.equal(comp.meanPence, 5600);
  assert.equal(comp.lowPence, 5200);
  assert.equal(comp.highPence, 6000);
  assert.equal(comp.card.tcgApiId, "sv3pt5-192");
  assert.equal((comp.raw as { kind?: string }).kind, "checked-comps");
  assert.equal((comp.raw as { entries?: unknown[] }).entries?.length, 3);
});

test("mapCheckedCompsToComp ignores stale rows and different grades", () => {
  const comp = mapCheckedCompsToComp(
    [
      checkedComp("cc_1", 5200, daysAgo(8)),
      checkedComp("cc_2", 999999, daysAgo(2), "ebay-uk", "PSA_10"),
      checkedComp("cc_3", 999999, daysAgo(120)),
    ],
    { source: "checked-comps", card, grade: "RAW", windowDays: 90 },
  );

  assert.equal(comp.sampleSize, 1);
  assert.equal(comp.medianPence, 5200);
});

test("CheckedCompsSource degrades to empty comp when the db lookup fails", async () => {
  const source = new CheckedCompsSource({
    card: {} as any,
    checkedComp: {
      async create() {
        throw new Error("not used");
      },
      async findMany() {
        throw new Error("db offline");
      },
    },
  });

  const comp = await source.lookup(card, { grade: "RAW" });
  assert.equal(comp.sampleSize, 0);
  assert.equal((comp.raw as { reason?: string }).reason, "checked comp lookup failed");
});

test("CheckedCompsSource requests only the exact card and grade", async () => {
  let seenWhere: unknown = null;
  const source = new CheckedCompsSource({
    card: {} as any,
    checkedComp: {
      async create() {
        throw new Error("not used");
      },
      async findMany(args) {
        seenWhere = args.where;
        return [checkedComp("cc_1", 5200, daysAgo(1), "ebay-uk", "PSA_10")];
      },
    },
  });

  await source.lookup(card, { grade: "PSA_10" });

  const where = seenWhere as { grade?: string; card?: { tcgApiId?: string } };
  assert.equal(where.grade, "PSA_10");
  assert.equal(where.card?.tcgApiId, "sv3pt5-192");
});

test("buildCheckedCompsWhere pins the exact card id and grade when available", () => {
  const where = buildCheckedCompsWhere({ ...card, id: "card_1" }, "RAW", 90) as {
    grade?: string;
    card?: { id?: string };
  };

  assert.equal(where.grade, "RAW");
  assert.equal(where.card?.id, "card_1");
});

test("buildCheckedCompsWhere matches canonical numeric collector numbers", () => {
  const where = buildCheckedCompsWhere(
    { name: "Tauros", setName: "Chaos Rising", number: "069/086", game: "POKEMON", language: "EN" },
    "RAW",
    90,
  ) as {
    card?: { OR?: Array<{ number: string }> };
  };

  assert.deepEqual(where.card?.OR, [{ number: "069/086" }, { number: "69/86" }]);
});

test("checked comp platform normalization keeps regions UK-first", () => {
  assert.equal(normalizeCheckedCompPlatform("ebay-uk"), "ebay-uk");
  assert.equal(normalizeCheckedCompPlatform("cardmarket"), "cardmarket");
  assert.equal(normalizeCheckedCompPlatform("unexpected"), "ebay-uk");
  assert.equal(checkedCompPlatformRegion("cardmarket"), "EU");
  assert.equal(checkedCompPlatformRegion("vinted"), "UK");
});

function checkedComp(
  id: string,
  pricePence: number,
  soldDate: Date,
  platform = "ebay-uk",
  grade: Grade = "RAW",
): CheckedCompRow {
  return {
    id,
    cardId: "card_1",
    grade,
    pricePence,
    soldDate,
    platform,
    note: null,
    sourceUrl: null,
    createdAt: soldDate,
    card: {
      id: "card_1",
      game: "POKEMON",
      language: "EN",
      name: "Zapdos ex",
      setName: "Scarlet & Violet 151",
      setCode: "sv3pt5",
      number: "192/165",
      rarity: "Ultra Rare",
      imageUrl: "https://example.test/zapdos.png",
      displayImageUrl: null,
      tcgApiId: "sv3pt5-192",
      tcgDexId: null,
      cardmarketId: null,
    },
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
