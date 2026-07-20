import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CheckedCompsSource,
  PrismaCheckedCompRepo,
  buildCheckedCompsWhere,
  checkedCompPlatformRegion,
  checkedCompSourceListingId,
  mapCheckedCompsToComp,
  normalizeCheckedCompPlatform,
  normalizeCheckedCompPriceBasis,
  normalizeCheckedCompSource,
  type CheckedCompDb,
  type CheckedCompPriceBasis,
  type CheckedCompRow,
} from "./checkedComps.js";
import { checkedCompConflictResponse } from "../checkedCompHttp.js";
import type { CardRef, Grade, RawCondition } from "../../domain/types.js";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const card: CardRef = {
  name: "Rayquaza VMAX",
  setName: "Evolving Skies",
  number: "218/203",
  tcgApiId: "swsh7-218",
  game: "POKEMON",
  language: "EN",
};

test("traceable condition-matched eBay UK solds produce the checked comp", () => {
  const rows = [
    checkedComp("cc_1", 45_000, daysAgo(5), { itemId: "100000000001" }),
    checkedComp("cc_2", 60_000, daysAgo(2), { itemId: "100000000002" }),
    checkedComp("cc_3", 75_000, daysAgo(1), { itemId: "100000000003" }),
  ];

  const comp = mapCheckedCompsToComp(rows, context("NM"));
  const raw = comp.raw as Record<string, unknown>;

  assert.equal(comp.source, "checked-comps");
  assert.equal(comp.sampleSize, 3);
  assert.equal(comp.medianPence, 60_000);
  assert.equal(comp.meanPence, 60_000);
  assert.equal(comp.lowPence, 45_000);
  assert.equal(comp.highPence, 75_000);
  assert.equal(comp.card.tcgApiId, "swsh7-218");
  assert.equal(raw.condition, "NM");
  assert.equal(raw.conditionMatched, true);
  assert.equal(raw.traceableCount, 3);
  assert.equal((raw.entries as unknown[]).length, 3);
});

test("source-backed Rayquaza fixture refuses hidden Best Offers, buyer totals, and wrong grades", () => {
  const fixture = JSON.parse(readFileSync(new URL("../__fixtures__/ebay-uk-rayquaza-vmax-218-203.json", import.meta.url), "utf8")) as {
    observations: Array<{
      itemId: string;
      url: string;
      soldAt: string;
      displayedTotalPence: number;
      itemPricePence: number | null;
      priceBasis: CheckedCompPriceBasis;
      grade: string;
      condition: RawCondition | null;
    }>;
  };
  const rows = fixture.observations
    .filter((observation) => observation.grade === "RAW")
    .map((observation, index) => checkedComp(
      `fixture_${index}`,
      observation.itemPricePence ?? observation.displayedTotalPence,
      new Date(observation.soldAt),
      {
        itemId: observation.itemId,
        sourceUrl: observation.url,
        condition: observation.condition ?? "NM",
        priceBasis: observation.priceBasis,
      },
    ));

  const comp = mapCheckedCompsToComp(rows, context("NM"));
  const raw = comp.raw as { entries?: Array<{ evidenceStatus?: string; exclusionReasons?: string[] }> };

  assert.equal(comp.sampleSize, 3);
  assert.equal(comp.medianPence, 85_000);
  assert.equal(comp.lowPence, 66_080);
  assert.equal(comp.highPence, 105_000);
  assert.equal(raw.entries?.filter((entry) => entry.evidenceStatus === "used").length, 3);
  assert.equal(raw.entries?.filter((entry) => entry.exclusionReasons?.includes("inexact-price-basis")).length, 5);
  assert.equal(fixture.observations.some((observation) => observation.grade === "OTHER_8"), true, "wrong-grade control is retained");
});

test("RAW repository writes fail closed when the condition bucket is missing", async () => {
  const repo = new PrismaCheckedCompRepo({} as never);
  await assert.rejects(
    repo.create({
      card,
      grade: "RAW",
      pricePence: 66_080,
      soldDate: daysAgo(1),
      platform: "ebay-uk",
      priceBasis: "DISPLAYED_PRICE",
      sourceUrl: "https://www.ebay.co.uk/itm/257584212141",
    }),
    /need NM, LP, MP, HP or DMG condition/,
  );
});

test("RAW checked evidence never crosses condition buckets", () => {
  const rows = [
    checkedComp("nm_1", 60_000, daysAgo(2), { itemId: "100000000011", condition: "NM" }),
    checkedComp("lp_1", 45_000, daysAgo(1), { itemId: "100000000012", condition: "LP" }),
  ];

  const nm = mapCheckedCompsToComp(rows, context("NM"));
  const lp = mapCheckedCompsToComp(rows, context("LP"));

  assert.equal(nm.sampleSize, 1);
  assert.equal(nm.medianPence, 60_000);
  assert.equal(lp.sampleSize, 1);
  assert.equal(lp.medianPence, 45_000);
});

test("RAW checked evidence without a lookup condition cannot become a price", () => {
  const comp = mapCheckedCompsToComp(
    [checkedComp("cc_1", 60_000, daysAgo(1), { itemId: "100000000021" })],
    { source: "checked-comps", card, grade: "RAW", windowDays: 90, now: NOW },
  );

  assert.equal(comp.sampleSize, 0);
  assert.equal(comp.medianPence, 0);
  assert.match(String((comp.raw as { reason?: string }).reason), /condition bucket/);
});

test("sold-search URLs and unlinked notes remain corroboration only", () => {
  const searchUrl = "https://www.ebay.co.uk/sch/i.html?_nkw=Rayquaza+218%2F203&LH_Sold=1&LH_Complete=1";
  const comp = mapCheckedCompsToComp(
    [checkedComp("search", 60_000, daysAgo(1), { itemId: null, sourceUrl: searchUrl })],
    context("NM"),
  );
  const entry = (comp.raw as { entries?: Array<{ evidenceStatus?: string; exclusionReasons?: string[] }> }).entries?.[0];

  assert.equal(comp.sampleSize, 0);
  assert.equal(entry?.evidenceStatus, "corroboration");
  assert.ok(entry?.exclusionReasons?.includes("missing-direct-sold-listing"));
  assert.throws(() => normalizeCheckedCompSource("ebay-uk", searchUrl), /individual sold item/);
});

test("stored listing ids cannot replace or contradict a direct sold-item URL", () => {
  const missingUrl = checkedComp("stored-only", 60_000, daysAgo(2), {
    itemId: null,
    sourceListingId: "ebay-uk:157802426654",
  });
  const contradictory = checkedComp("contradictory", 61_000, daysAgo(1), {
    itemId: null,
    sourceUrl: "https://www.ebay.co.uk/itm/157802426654",
    sourceListingId: "ebay-uk:318208105044",
  });
  const comp = mapCheckedCompsToComp([missingUrl, contradictory], context("NM"));
  const entries = (comp.raw as { entries?: Array<{ exclusionReasons?: string[] }> }).entries ?? [];

  assert.equal(comp.sampleSize, 0);
  assert.ok(entries.some((entry) => entry.exclusionReasons?.includes("missing-direct-sold-listing")));
  assert.ok(entries.some((entry) => entry.exclusionReasons?.includes("listing-id-mismatch")));
});

test("duplicate eBay item ids count once even when URL forms differ", () => {
  const rows = [
    checkedComp("first", 55_000, daysAgo(2), { itemId: "157802426654" }),
    checkedComp("duplicate", 99_999, daysAgo(1), {
      itemId: null,
      sourceUrl: "https://www.ebay.co.uk/itm/Rayquaza-VMAX/157802426654?hash=tracking",
      sourceListingId: "ebay-uk:157802426654",
    }),
  ];
  const comp = mapCheckedCompsToComp(rows, context("NM"));

  assert.equal(comp.sampleSize, 1);
  assert.equal(comp.medianPence, 55_000);
});

test("IQR cleaning removes a gross manual-entry outlier without deleting its audit row", () => {
  const prices = [55_000, 56_000, 57_000, 58_000, 2_729_000];
  const rows = prices.map((price, index) => checkedComp(
    `cc_${index}`,
    price,
    daysAgo(5 - index),
    { itemId: `1000000001${String(index).padStart(2, "0")}` },
  ));
  const comp = mapCheckedCompsToComp(rows, context("NM"));
  const entries = (comp.raw as { entries?: Array<{ evidenceStatus?: string }> }).entries ?? [];

  assert.equal(comp.sampleSize, 4);
  assert.equal(comp.medianPence, 56_500);
  assert.equal(comp.outliersRemoved, 1);
  assert.equal(entries.filter((entry) => entry.evidenceStatus === "outlier").length, 1);
});

test("voided evidence stays in the receipt but cannot affect the sample or traceable count", () => {
  const rows = [
    checkedComp("bad", 100_000, daysAgo(3), {
      itemId: "100000000041",
      voidedAt: daysAgo(1),
      voidReason: "Wrong card condition",
    }),
    checkedComp("low", 45_000, daysAgo(2), { itemId: "100000000042" }),
    checkedComp("high", 75_000, daysAgo(1), { itemId: "100000000043" }),
  ];

  const comp = mapCheckedCompsToComp(rows, context("NM"));
  const raw = comp.raw as {
    traceableCount?: number;
    entries?: Array<{ id?: string; traceable?: boolean; voidedAt?: string; exclusionReasons?: string[] }>;
  };
  const voided = raw.entries?.find((entry) => entry.id === "bad");

  assert.equal(comp.sampleSize, 2);
  assert.equal(comp.medianPence, 60_000);
  assert.equal(raw.traceableCount, 2);
  assert.equal(raw.entries?.length, 3);
  assert.equal(voided?.traceable, false);
  assert.ok(voided?.voidedAt);
  assert.ok(voided?.exclusionReasons?.includes("voided"));
});

test("a corrected re-log of the same listing qualifies after the old observation is voided", () => {
  const itemId = "100000000045";
  const old = checkedComp("old", 100_000, daysAgo(3), {
    itemId,
    voidedAt: daysAgo(2),
    voidReason: "Price included postage",
  });
  const corrected = checkedComp("corrected", 60_000, daysAgo(1), { itemId });
  const comp = mapCheckedCompsToComp([old, corrected], context("NM"));
  const entries = (comp.raw as {
    entries?: Array<{ id?: string; evidenceStatus?: string; exclusionReasons?: string[] }>;
  }).entries ?? [];

  assert.equal(comp.sampleSize, 1);
  assert.equal(comp.medianPence, 60_000);
  assert.equal(entries.find((entry) => entry.id === "corrected")?.evidenceStatus, "used");
  assert.doesNotMatch(
    (entries.find((entry) => entry.id === "corrected")?.exclusionReasons ?? []).join(" "),
    /duplicate-listing/,
  );
});

test("voiding is idempotent and preserves the first reason and timestamp", async () => {
  let row = checkedComp("cc_void", 60_000, daysAgo(1), { itemId: "100000000044" });
  let successfulTransitions = 0;
  const db = {
    card: {} as CheckedCompDb["card"],
    checkedComp: {
      async create() { throw new Error("not used"); },
      async findMany() { return []; },
      async updateMany(args: { where: { id: string; voidedAt: null }; data: { voidedAt: Date; voidReason: string } }) {
        if (row.id === args.where.id && row.voidedAt === null) {
          row = { ...row, ...args.data };
          successfulTransitions += 1;
          return { count: 1 };
        }
        return { count: 0 };
      },
      async findUnique() { return row; },
    },
  } as CheckedCompDb;
  const repo = new PrismaCheckedCompRepo(db);

  const first = await repo.void(row.id, "Wrong condition");
  const retried = await repo.void(row.id, "A later retry must not overwrite this");

  assert.equal(successfulTransitions, 1);
  assert.equal(first.voidReason, "Wrong condition");
  assert.equal(retried.voidReason, "Wrong condition");
  assert.equal(retried.voidedAt?.toISOString(), first.voidedAt?.toISOString());
});

test("a duplicate active listing on another card maps to 409, while unrelated uniqueness failures do not", () => {
  const crossCardConflict = checkedCompConflictResponse({
    code: "P2002",
    meta: { target: ["sourceListingId"] },
  });
  const catalogConflict = checkedCompConflictResponse({
    code: "P2002",
    meta: { target: ["tcgApiId"] },
  });

  assert.equal(crossCardConflict?.status, 409);
  assert.equal(crossCardConflict?.body.code, "duplicate-listing");
  assert.match(crossCardConflict?.body.error ?? "", /void it first/i);
  assert.equal(catalogConflict, null);
});

test("the listing constraint is global across cards and releases only voided rows", () => {
  const migration = readFileSync(
    new URL("../../../../prisma/migrations/20260720120000_checked_comp_voids/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /UNIQUE INDEX "CheckedComp_sourceListingId_key"[\s\S]*\("sourceListingId"\)/);
  assert.match(migration, /WHERE "voidedAt" IS NULL/);
  assert.doesNotMatch(migration, /UNIQUE INDEX[\s\S]{0,180}\("cardId",\s*"sourceListingId"\)/);
});

test("CheckedCompsSource degrades to explicit empty evidence when the database fails", async () => {
  const source = new CheckedCompsSource({
    card: {} as never,
    checkedComp: {
      async create() {
        throw new Error("not used");
      },
      async findMany() {
        throw new Error("db offline");
      },
      async updateMany() { return { count: 0 }; },
      async findUnique() { return null; },
    },
  });

  const comp = await source.lookup(card, { grade: "RAW", condition: "NM" });
  assert.equal(comp.sampleSize, 0);
  assert.equal((comp.raw as { reason?: string }).reason, "checked comp lookup failed");
});

test("CheckedCompsSource keeps provider ids and exact print identity in the lookup", async () => {
  let seenWhere: unknown = null;
  const source = new CheckedCompsSource({
    card: {} as never,
    checkedComp: {
      async create() {
        throw new Error("not used");
      },
      async findMany(args) {
        seenWhere = args.where;
        return [checkedComp("cc_1", 52_000, daysAgo(1), { itemId: "100000000031", grade: "PSA_10", condition: null })];
      },
      async updateMany() { return { count: 0 }; },
      async findUnique() { return null; },
    },
  });

  await source.lookup(card, { grade: "PSA_10" });

  const where = seenWhere as { grade?: string; condition?: string | null; card?: unknown };
  assert.equal(where.grade, "PSA_10");
  assert.equal(where.condition, null);
  assert.match(JSON.stringify(where.card), /swsh7-218/);
  assert.match(JSON.stringify(where.card), /Rayquaza VMAX/);
  assert.match(JSON.stringify(where.card), /218\/203/);
});

test("buildCheckedCompsWhere pins exact identities and canonical numeric numbers", () => {
  const byId = buildCheckedCompsWhere({ ...card, id: "card_1" }, "RAW", 90, "NM") as {
    grade?: string;
    condition?: string;
    card?: { id?: string };
  };
  const byNumber = buildCheckedCompsWhere(
    { name: "Tauros", setName: "Chaos Rising", number: "069/086", game: "POKEMON", language: "EN" },
    "RAW",
    90,
  ) as { card?: unknown };
  const shortProviderNumber = buildCheckedCompsWhere(
    { name: "Rayquaza VMAX", setName: "Evolving Skies", number: "218", tcgDexId: "swsh7-218", game: "POKEMON", language: "EN" },
    "RAW",
    90,
    "NM",
  ) as { card?: unknown };

  assert.equal(byId.grade, "RAW");
  assert.equal(byId.condition, "NM");
  assert.equal(byId.card?.id, "card_1");
  assert.match(JSON.stringify(byNumber.card), /069\/086/);
  assert.match(JSON.stringify(byNumber.card), /69\/86/);
  assert.match(JSON.stringify(byNumber.card), /startsWith/);
  assert.match(JSON.stringify(shortProviderNumber.card), /swsh7-218/);
  assert.match(JSON.stringify(shortProviderNumber.card), /"startsWith":"218\/"/);
  assert.match(JSON.stringify(shortProviderNumber.card), /Evolving Skies/);
});

test("eBay item URL normalization is strict, stable, and UK-only", () => {
  assert.equal(
    checkedCompSourceListingId("ebay-uk", "https://www.ebay.co.uk/itm/Rayquaza/157802426654?mkcid=1"),
    "ebay-uk:157802426654",
  );
  assert.equal(checkedCompSourceListingId("ebay-uk", "https://www.ebay.com/itm/157802426654"), null);
  assert.equal(checkedCompSourceListingId("ebay-uk", "https://www.ebay.co.uk/sch/i.html?item=157802426654"), null);
  assert.deepEqual(
    normalizeCheckedCompSource("ebay-uk", "https://m.ebay.co.uk/itm/Rayquaza/157802426654?hash=abc"),
    { url: "https://www.ebay.co.uk/itm/157802426654", listingId: "ebay-uk:157802426654" },
  );
});

test("platform and price-basis normalization fail closed", () => {
  assert.equal(normalizeCheckedCompPlatform("cardmarket"), "cardmarket");
  assert.equal(normalizeCheckedCompPlatform(undefined), "ebay-uk");
  assert.equal(normalizeCheckedCompPlatform("unexpected"), "other");
  assert.equal(checkedCompPlatformRegion("cardmarket"), "EU");
  assert.equal(checkedCompPlatformRegion("vinted"), "UK");
  assert.equal(normalizeCheckedCompPriceBasis("ITEM_PRICE"), "ITEM_PRICE");
  assert.equal(normalizeCheckedCompPriceBasis("DISPLAYED_PRICE"), "DISPLAYED_PRICE");
  assert.equal(normalizeCheckedCompPriceBasis("unexpected"), "UNKNOWN");
});

function context(condition: RawCondition) {
  return { source: "checked-comps", card, grade: "RAW" as const, condition, windowDays: 90, now: NOW };
}

function checkedComp(
  id: string,
  pricePence: number,
  soldDate: Date,
  options: {
    itemId?: string | null;
    sourceUrl?: string;
    sourceListingId?: string | null;
    platform?: string;
    grade?: Grade;
    condition?: RawCondition | null;
    priceBasis?: CheckedCompPriceBasis;
    voidedAt?: Date | null;
    voidReason?: string | null;
  } = {},
): CheckedCompRow {
  const itemId = options.itemId === undefined ? id.replace(/\D/g, "").padStart(12, "1").slice(-12) : options.itemId;
  const sourceUrl = options.sourceUrl ?? (itemId ? `https://www.ebay.co.uk/itm/${itemId}` : null);
  return {
    id,
    cardId: "card_1",
    grade: options.grade ?? "RAW",
    pricePence,
    soldDate,
    platform: options.platform ?? "ebay-uk",
    condition: options.condition === undefined ? "NM" : options.condition,
    priceBasis: options.priceBasis ?? "DISPLAYED_PRICE",
    note: null,
    sourceUrl,
    sourceListingId: options.sourceListingId === undefined && itemId ? `ebay-uk:${itemId}` : options.sourceListingId ?? null,
    voidedAt: options.voidedAt ?? null,
    voidReason: options.voidReason ?? null,
    createdAt: soldDate,
    card: {
      id: "card_1",
      game: "POKEMON",
      language: "EN",
      name: "Rayquaza VMAX",
      setName: "Evolving Skies",
      setCode: "swsh7",
      number: "218/203",
      rarity: "Secret Rare",
      imageUrl: "https://example.test/rayquaza.png",
      displayImageUrl: null,
      tcgApiId: "swsh7-218",
      tcgDexId: null,
      cardmarketId: null,
    },
  };
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}
