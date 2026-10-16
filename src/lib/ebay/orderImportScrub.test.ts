import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { minimalOrderImportPayload, planOrderImportPayloadScrub } from "./orderImportPayload.js";
import { parseScrubArgs, scrubOrderImportBuyerData, type OrderImportScrubDb } from "./orderImportScrub.js";

// Synthetic fixtures only. A legacy payload is eBay's full order object plus
// the line, as imports stored it before the minimal projection.
const STORED_JSON_NULL = Symbol("stored JSON null");

function legacyPayload(orderId: string, buyer = "buyer-1") {
  return {
    order: {
      orderId,
      creationDate: "2026-05-01T10:00:00.000Z",
      lastModifiedDate: "2026-05-02T10:00:00.000Z",
      orderPaymentStatus: "PAID",
      orderFulfillmentStatus: "FULFILLED",
      buyer: { username: buyer, taxAddress: { postalCode: "AB1 2CD" }, buyerRegistrationAddress: { fullName: "Pat Buyer", email: "pat@example.test" } },
      fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "Pat Buyer", contactAddress: { addressLine1: "1 Test Street" } } } }],
      buyerCheckoutNotes: "please pack well",
      lineItems: [{ lineItemId: "line-1", title: "Charizard ex 199/165" }],
    },
    line: { lineItemId: "line-1", legacyItemId: "1234567890", sku: "PD-1", title: "Charizard ex 199/165", quantity: 1, total: { value: "12.00", currency: "GBP" } },
  };
}

test("legacy payloads are rewritten to the allowlisted projection with no buyer data", () => {
  const plan = planOrderImportPayloadScrub(legacyPayload("order-1"));
  assert.equal(plan.kind, "rewrite");
  assert.ok(plan.kind === "rewrite");
  assert.deepEqual(plan.payload, {
    schemaVersion: 1,
    order: {
      orderId: "order-1",
      creationDate: "2026-05-01T10:00:00.000Z",
      lastModifiedDate: "2026-05-02T10:00:00.000Z",
      orderPaymentStatus: "PAID",
      orderFulfillmentStatus: "FULFILLED",
    },
    line: { lineItemId: "line-1", legacyItemId: "1234567890", sku: "PD-1", title: "Charizard ex 199/165", quantity: 1 },
  });
  const text = JSON.stringify(plan.payload);
  for (const needle of ["buyer-1", "Pat Buyer", "pat@example.test", "AB1 2CD", "Test Street", "please pack well"]) {
    assert.equal(text.includes(needle), false, `scrubbed payload still contains ${needle}`);
  }
});

test("payloads already in the minimal shape, including held amounts, are kept", () => {
  const order = { orderId: "order-2", creationDate: "2026-06-01T00:00:00.000Z", buyer: { username: "buyer-2" } };
  const line = { lineItemId: "line-2", title: "Pikachu", quantity: 2 };
  const held = { total: { value: "20.00", currency: "USD" }, deliveryCost: { shippingCost: { value: "3.00", currency: "USD" } } };
  const stored = JSON.parse(JSON.stringify(minimalOrderImportPayload(order, line, held)));
  assert.deepEqual(planOrderImportPayloadScrub(stored), { kind: "keep" });
  assert.deepEqual(stored.heldAmounts, held);
  assert.equal(JSON.stringify(stored).includes("buyer-2"), false);
});

test("nested objects under allowlisted names and unknown shapes never survive", () => {
  const sneaky = { schemaVersion: 1, order: { orderId: { buyer: "buyer-3" } }, line: { title: "Card", sku: ["buyer-3"] }, extra: "buyer-3" };
  const plan = planOrderImportPayloadScrub(sneaky);
  assert.ok(plan.kind === "rewrite");
  assert.deepEqual(plan.payload, { schemaVersion: 1, order: {}, line: { title: "Card" } });

  for (const payload of [{ buyer: { username: "buyer-3" } }, ["buyer-3"], "buyer-3", 42, { order: { buyer: "buyer-3" } }]) {
    assert.deepEqual(planOrderImportPayloadScrub(payload), { kind: "clear" }, JSON.stringify(payload));
  }
  assert.deepEqual(planOrderImportPayloadScrub(null), { kind: "keep" });
});

test("parseScrubArgs is a dry run unless --apply is explicit", () => {
  assert.deepEqual(parseScrubArgs([]), { apply: false, batchSize: 200 });
  assert.deepEqual(parseScrubArgs(["--dry-run"]), { apply: false, batchSize: 200 });
  assert.deepEqual(parseScrubArgs(["--apply", "--batch-size=50"]), { apply: true, batchSize: 50 });
  for (const argv of [["--aply"], ["apply"], ["--apply=true"], ["--batch-size=0"], ["--batch-size=2.5"], ["--batch-size=5000"]]) {
    assert.throws(() => parseScrubArgs(argv), Error, argv.join(" "));
  }
});

test("dry run reads every page and writes nothing", async () => {
  const fixture = fakeScrubDb();
  const before = structuredClone(fixture.rows.map(({ payload, ...rest }) => ({ ...rest, payload: payload === STORED_JSON_NULL ? "json-null" : payload })));
  const summary = await scrubOrderImportBuyerData(fixture.db, { apply: false, batchSize: 2 });
  assert.deepEqual(summary, { apply: false, scanned: 4, alreadyMinimal: 1, rewritten: 2, cleared: 1, skippedConcurrent: 0 });
  assert.equal(fixture.updateCalls.length, 0);
  assert.deepEqual(fixture.rows.map(({ payload, ...rest }) => ({ ...rest, payload: payload === STORED_JSON_NULL ? "json-null" : payload })), before);
  assert.equal(fixture.findManyCalls.length, 3);
});

test("apply scrubs only payloads, uses Prisma null sentinels, and a second run changes nothing", async () => {
  const fixture = fakeScrubDb();
  const ledgerBefore = fixture.rows.map(({ payload, updatedAt, ...ledger }) => ledger);

  const first = await scrubOrderImportBuyerData(fixture.db, { apply: true, batchSize: 2 });
  assert.deepEqual(first, { apply: true, scanned: 4, alreadyMinimal: 1, rewritten: 2, cleared: 1, skippedConcurrent: 0 });
  for (const call of fixture.findManyCalls) {
    assert.equal(call.where.payload.not, Prisma.AnyNull, "the payload filter must be Prisma.AnyNull");
  }
  for (const call of fixture.updateCalls) {
    assert.deepEqual(Object.keys(call.data), ["payload"]);
    assert.deepEqual(Object.keys(call.where).sort(), ["id", "updatedAt"]);
    assert.notEqual(call.data.payload, null, "plain null is read as JSON null by Prisma 5");
  }
  assert.equal(fixture.updateCalls.find((call) => call.where.id === "c-unknown")?.data.payload, Prisma.DbNull);
  assert.equal(fixture.rows.find((row) => row.id === "c-unknown")?.payload, null);
  assert.equal(fixture.rows.find((row) => row.id === "f-json-null")?.payload, STORED_JSON_NULL, "stored JSON null is left alone");
  assert.equal(JSON.stringify(fixture.rows).includes("buyer-"), false);
  assert.deepEqual(fixture.rows.map(({ payload, updatedAt, ...ledger }) => ledger), ledgerBefore);

  fixture.findManyCalls.length = 0;
  fixture.updateCalls.length = 0;
  const second = await scrubOrderImportBuyerData(fixture.db, { apply: true, batchSize: 2 });
  assert.deepEqual(second, { apply: true, scanned: 3, alreadyMinimal: 3, rewritten: 0, cleared: 0, skippedConcurrent: 0 });
  assert.equal(fixture.updateCalls.length, 0);
});

test("apply never overwrites a row that changed after it was read", async () => {
  const fixture = fakeScrubDb();
  const findMany = fixture.db.ebayOrderImport.findMany.bind(fixture.db.ebayOrderImport);
  let raced = false;
  (fixture.db.ebayOrderImport as any).findMany = async (args: any) => {
    const result = await findMany(args);
    if (!raced) {
      raced = true;
      const row = fixture.rows.find((candidate) => candidate.id === "a-legacy")!;
      row.payload = minimalOrderImportPayload({ orderId: "order-a", orderPaymentStatus: "PAID" }, { lineItemId: "line-a" });
      row.updatedAt = new Date(row.updatedAt.getTime() + 1);
    }
    return result;
  };
  const summary = await scrubOrderImportBuyerData(fixture.db, { apply: true, batchSize: 10 });
  assert.equal(summary.skippedConcurrent, 1);
  assert.deepEqual((fixture.rows.find((row) => row.id === "a-legacy")!.payload as any).order, { orderId: "order-a", orderPaymentStatus: "PAID" });
});

test("scrub round trip on a real Prisma client minimises legacy payloads and is idempotent", async (context) => {
  const databaseUrl = disposableCiDatabaseUrl();
  if (!databaseUrl) {
    context.skip("no disposable CI database (needs CI=true and a loopback DATABASE_URL); scrub round-trip skipped cleanly");
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const tag = `scrub-buyers-${randomUUID()}`;
  try {
    await prisma.ebayOrderImport.createMany({
      data: [
        { importKey: `${tag}-legacy`, orderId: tag, payload: legacyPayload(tag, `${tag}-buyer`) },
        { importKey: `${tag}-unknown`, orderId: tag, payload: { buyer: `${tag}-buyer` } },
        { importKey: `${tag}-dbnull`, orderId: tag, payload: Prisma.DbNull },
        { importKey: `${tag}-jsonnull`, orderId: tag, payload: Prisma.JsonNull },
      ],
    });
    await scrubOrderImportBuyerData(prisma, { apply: true, batchSize: 1000 });
    const rows = await prisma.ebayOrderImport.findMany({ where: { orderId: tag }, select: { importKey: true, payload: true } });
    assert.equal(JSON.stringify(rows).includes(`${tag}-buyer`), false);
    const unknown = await prisma.ebayOrderImport.findMany({ where: { orderId: tag, payload: { equals: Prisma.DbNull } }, select: { importKey: true } });
    assert.deepEqual(unknown.map((row) => row.importKey).sort(), [`${tag}-dbnull`, `${tag}-unknown`]);
    const again = await scrubOrderImportBuyerData(prisma, { apply: false, batchSize: 1000 });
    assert.equal(again.rewritten + again.cleared, 0);
  } finally {
    await prisma.ebayOrderImport.deleteMany({ where: { orderId: tag } });
    await prisma.$disconnect();
  }
});

// In-memory stand-in for the two delegate methods. A stored `null` is a
// database NULL and STORED_JSON_NULL a stored JSON null, as Postgres keeps
// them for a nullable Json column.
function fakeScrubDb() {
  const at = new Date("2026-07-01T00:00:00.000Z");
  const rows: Array<{ id: string; orderId: string; buyerPaidPence: number | null; saleId: string | null; updatedAt: Date; payload: unknown }> = [
    { id: "a-legacy", orderId: "order-a", buyerPaidPence: 1200, saleId: "sale-a", updatedAt: at, payload: legacyPayload("order-a", "buyer-a") },
    { id: "b-minimal", orderId: "order-b", buyerPaidPence: 800, saleId: null, updatedAt: at, payload: JSON.parse(JSON.stringify(minimalOrderImportPayload({ orderId: "order-b" }, { lineItemId: "line-b" }))) },
    { id: "c-unknown", orderId: "order-c", buyerPaidPence: null, saleId: null, updatedAt: at, payload: { buyer: { username: "buyer-c" } } },
    { id: "d-legacy", orderId: "order-d", buyerPaidPence: 500, saleId: "sale-d", updatedAt: at, payload: legacyPayload("order-d", "buyer-d") },
    { id: "e-db-null", orderId: "order-e", buyerPaidPence: 100, saleId: null, updatedAt: at, payload: null },
    { id: "f-json-null", orderId: "order-f", buyerPaidPence: 100, saleId: null, updatedAt: at, payload: STORED_JSON_NULL },
  ];
  const findManyCalls: any[] = [];
  const updateCalls: any[] = [];
  const delegate = {
    async findMany(args: any) {
      findManyCalls.push(args);
      if (args.where.payload.not !== Prisma.AnyNull) throw new Error("fakeScrubDb only models AnyNull");
      const after: string | undefined = args.where.id?.gt;
      return rows
        .filter((row) => row.payload !== null && row.payload !== STORED_JSON_NULL && (!after || row.id > after))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, args.take)
        .map((row) => ({ id: row.id, payload: structuredClone(row.payload), updatedAt: row.updatedAt }));
    },
    async updateMany(args: any) {
      updateCalls.push(args);
      const row = rows.find((candidate) => candidate.id === args.where.id && candidate.updatedAt.getTime() === args.where.updatedAt.getTime());
      if (!row) return { count: 0 };
      const payload = args.data.payload;
      row.payload = payload === Prisma.DbNull ? null : payload === null || payload === Prisma.JsonNull ? STORED_JSON_NULL : JSON.parse(JSON.stringify(payload));
      row.updatedAt = new Date(row.updatedAt.getTime() + 1);
      return { count: 1 };
    },
  };
  return { db: { ebayOrderImport: delegate } as unknown as OrderImportScrubDb, rows, findManyCalls, updateCalls };
}

// The round-trip test writes rows, so it only runs against the throwaway
// Postgres service CI starts on loopback; never a developer or hosted DB.
function disposableCiDatabaseUrl(): string | null {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl || process.env.CI !== "true") return null;
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname) ? databaseUrl : null;
  } catch {
    return null;
  }
}
