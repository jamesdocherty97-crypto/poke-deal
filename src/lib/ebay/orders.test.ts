import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFulfillmentOrdersPath,
  importEbayOrderLine,
  normalizePaidEbayOrder,
  type NormalizedEbayOrderLine,
} from "./orders.js";

test("buildFulfillmentOrdersPath requests recent fulfillment orders with a bounded limit", () => {
  const path = buildFulfillmentOrdersPath({
    since: new Date("2026-07-01T00:00:00.000Z"),
    until: new Date("2026-07-03T00:00:00.000Z"),
    limit: 500,
  });
  const url = new URL(`https://api.ebay.com${path}`);

  assert.equal(url.pathname, "/sell/fulfillment/v1/order");
  assert.equal(url.searchParams.get("limit"), "100");
  assert.equal(url.searchParams.get("filter"), "creationdate:[2026-07-01T00:00:00.000Z..2026-07-03T00:00:00.000Z]");
});

test("normalizePaidEbayOrder maps paid order lines to GBP pence and import keys", () => {
  const lines = normalizePaidEbayOrder({
    orderId: "01-12345-67890",
    creationDate: "2026-07-03T10:00:00.000Z",
    orderPaymentStatus: "PAID",
    pricingSummary: {
      deliveryCost: { value: "4.99", currency: "GBP" },
    },
    paymentSummary: {
      payments: [{ paymentStatus: "PAID", paymentDate: "2026-07-03T10:01:00.000Z" }],
    },
    lineItems: [
      {
        lineItemId: "line-1",
        legacyItemId: "1234567890",
        sku: "pdos-item-1",
        title: "Charizard ex 151 PSA 10",
        quantity: 1,
        lineItemCost: { value: "100.00", currency: "GBP" },
      },
    ],
  });

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.importKey, "ebay:01-12345-67890:line-1");
  assert.equal(lines[0]?.buyerPaidPence, 10499);
  assert.equal(lines[0]?.postageChargedPence, 499);
  assert.equal(lines[0]?.paidAt?.toISOString(), "2026-07-03T10:01:00.000Z");
});

test("normalizePaidEbayOrder ignores unpaid orders", () => {
  assert.deepEqual(
    normalizePaidEbayOrder({
      orderId: "order-1",
      orderPaymentStatus: "PENDING",
      lineItems: [{ lineItemId: "line-1", lineItemCost: { value: "10.00", currency: "GBP" } }],
    }),
    [],
  );
});

test("importEbayOrderLine books a matched listing sale and is idempotent", async () => {
  const db = fakeEbaySyncDb();
  const line = orderLine({ sku: "pdos-listing-1", buyerPaidPence: 10499, postageChargedPence: 499 });

  const first = await importEbayOrderLine(db.client, line);
  const second = await importEbayOrderLine(db.client, line);

  assert.equal(first.status, "MATCHED");
  assert.equal(first.saleId, "sale-1");
  assert.equal(second.status, "SKIPPED");
  assert.equal(db.sales.length, 1);
  assert.equal(db.sales[0]?.channel, "EBAY");
  assert.equal(db.sales[0]?.salePrice, 10499);
  assert.equal(db.sales[0]?.fees, 1374);
  assert.equal(db.sales[0]?.postage, 499);
  assert.equal(db.items[0]?.status, "SOLD");
  assert.equal(db.listings[0]?.state, "SOLD");
  assert.equal(db.appAlerts[0]?.kind, "EBAY_SALE");
});

test("importEbayOrderLine matches the future item-id SKU shape", async () => {
  const db = fakeEbaySyncDb();
  const result = await importEbayOrderLine(
    db.client,
    orderLine({ importKey: "ebay:order-2:line-1", sku: "pdos-item-1", buyerPaidPence: 5175, postageChargedPence: 175 }),
  );

  assert.equal(result.status, "MATCHED");
  assert.equal(result.itemId, "item-1");
  assert.equal(result.listingId, "listing-1");
  assert.equal(db.sales.length, 1);
});

test("importEbayOrderLine leaves unmatched orders in a manual queue", async () => {
  const db = fakeEbaySyncDb({ includeListing: false, includeItem: false });
  const result = await importEbayOrderLine(db.client, orderLine({ sku: "pdos-missing" }));

  assert.equal(result.status, "UNMATCHED");
  assert.match(result.reason ?? "", /No Poke Deal stock row/);
  assert.equal(db.sales.length, 0);
  assert.equal(db.imports[0]?.status, "UNMATCHED");
});

function orderLine(input: Partial<NormalizedEbayOrderLine> = {}): NormalizedEbayOrderLine {
  return {
    importKey: "ebay:order-1:line-1",
    orderId: "order-1",
    lineItemId: "line-1",
    sku: "pdos-listing-1",
    ebayItemId: "1234567890",
    title: "Charizard ex 151 PSA 10",
    quantity: 1,
    orderCreatedAt: new Date("2026-07-03T10:00:00.000Z"),
    paidAt: new Date("2026-07-03T10:01:00.000Z"),
    itemSubtotalPence: 10000,
    postageChargedPence: 499,
    buyerPaidPence: 10499,
    raw: { fixture: true },
    ...input,
  };
}

function fakeEbaySyncDb(options: { includeListing?: boolean; includeItem?: boolean } = {}) {
  const includeListing = options.includeListing ?? true;
  const includeItem = options.includeItem ?? true;
  const card = { id: "card-1", name: "Charizard ex", setName: "151", number: "199/165" };
  const items = includeItem
    ? [{ id: "item-1", quantity: 1, status: "LISTED", grade: "PSA_10", costBasis: 70000, card, listings: [] as any[] }]
    : [];
  const listings = includeListing
    ? [{ id: "listing-1", itemId: "item-1", channel: "EBAY", state: "ACTIVE", externalRef: "1234567890", item: items[0] }]
    : [];
  if (items[0]) items[0].listings = listings;
  const imports: any[] = [];
  const sales: any[] = [];
  const appAlerts: any[] = [];

  const client = {
    async $transaction(fn: any) {
      return fn(client);
    },
    ebayOrderImport: {
      async findUnique({ where }: any) {
        return imports.find((row) => row.importKey === where.importKey) ?? null;
      },
      async findMany() {
        return imports;
      },
      async create({ data }: any) {
        imports.push({ id: `import-${imports.length + 1}`, ...data });
        return imports[imports.length - 1];
      },
      async update({ where, data }: any) {
        const row = imports.find((candidate) => candidate.importKey === where.importKey || candidate.id === where.id);
        if (!row) throw new Error("missing import");
        Object.assign(row, data);
        return row;
      },
      async upsert({ where, create, update }: any) {
        const row = imports.find((candidate) => candidate.importKey === where.importKey);
        if (row) {
          Object.assign(row, update);
          return row;
        }
        imports.push({ id: `import-${imports.length + 1}`, ...create });
        return imports[imports.length - 1];
      },
    },
    listing: {
      async findUnique({ where }: any) {
        return listings.find((listing) => listing.id === where.id) ?? null;
      },
      async findFirst({ where }: any) {
        return listings.find((listing) => listing.externalRef === where.externalRef) ?? null;
      },
      async updateMany({ where, data }: any) {
        const matches = listings.filter((listing) => {
          if (where.id && listing.id !== where.id) return false;
          if (where.itemId && listing.itemId !== where.itemId) return false;
          return true;
        });
        matches.forEach((listing) => Object.assign(listing, data));
        return { count: matches.length };
      },
    },
    inventoryItem: {
      async findUnique({ where }: any) {
        return items.find((item) => item.id === where.id) ?? null;
      },
      async update({ where, data }: any) {
        const item = items.find((candidate) => candidate.id === where.id);
        if (!item) throw new Error("missing item");
        Object.assign(item, data);
        return item;
      },
    },
    sale: {
      async create({ data }: any) {
        const row = { id: `sale-${sales.length + 1}`, ...data };
        sales.push(row);
        return row;
      },
    },
    appAlert: {
      async create({ data }: any) {
        appAlerts.push({ id: `alert-${appAlerts.length + 1}`, ...data });
        return appAlerts[appAlerts.length - 1];
      },
      async upsert({ where, create, update }: any) {
        const row = appAlerts.find((alert) => alert.sourceKey === where.sourceKey);
        if (row) {
          Object.assign(row, update);
          return row;
        }
        appAlerts.push({ id: `alert-${appAlerts.length + 1}`, ...create });
        return appAlerts[appAlerts.length - 1];
      },
    },
  };

  return { client: client as any, items, listings, imports, sales, appAlerts };
}
