import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFulfillmentOrdersPath,
  ebayOrderLineSignals,
  importEbayOrderLine,
  normalizePaidEbayOrder,
  syncOwnEbaySales,
  type NormalizedEbayOrderLine,
} from "./orders.js";
import type { EbayConfig } from "./config.js";

const TEST_CONFIG: EbayConfig = {
  clientId: "TestClient-123",
  clientSecret: "test-secret",
  ruName: "TestApp-RuName-1234",
  env: "sandbox",
  marketplaceId: "EBAY_GB",
  contentLanguage: "en-GB",
  apiBaseUrl: "https://api.sandbox.ebay.com",
  authBaseUrl: "https://auth.sandbox.ebay.com",
  tokenUrl: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
};

test("buildFulfillmentOrdersPath requests recent orders by creation date with a bounded limit", () => {
  const path = buildFulfillmentOrdersPath({
    since: new Date("2026-07-01T00:00:00.000Z"),
    until: new Date("2026-07-03T00:00:00.000Z"),
    limit: 500,
  });
  const url = new URL(`https://api.ebay.com${path}`);

  assert.equal(url.pathname, "/sell/fulfillment/v1/order");
  assert.equal(url.searchParams.get("limit"), "100");
  assert.equal(url.searchParams.get("offset"), "0");
  assert.equal(url.searchParams.get("filter"), "creationdate:[2026-07-01T00:00:00.000Z..2026-07-03T00:00:00.000Z]");
  // The separate signals read uses last-modified date to see later refunds and cancellations.
  const byModified = new URL(`https://api.ebay.com${buildFulfillmentOrdersPath({
    since: new Date("2026-07-01T00:00:00.000Z"),
    until: new Date("2026-07-03T00:00:00.000Z"),
    dateField: "lastmodifieddate",
  })}`);
  assert.equal(byModified.searchParams.get("filter"), "lastmodifieddate:[2026-07-01T00:00:00.000Z..2026-07-03T00:00:00.000Z]");
});

test("syncOwnEbaySales follows Fulfillment pagination before importing", async () => {
  const savedEnv = {
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    ruName: process.env.EBAY_RU_NAME,
    refreshToken: process.env.EBAY_REFRESH_TOKEN,
  };
  process.env.EBAY_CLIENT_ID = TEST_CONFIG.clientId;
  process.env.EBAY_CLIENT_SECRET = TEST_CONFIG.clientSecret;
  process.env.EBAY_RU_NAME = TEST_CONFIG.ruName;
  process.env.EBAY_REFRESH_TOKEN = "refresh-token";
  const offsets: string[] = [];
  const fetchImpl: typeof globalThis.fetch = (url) => {
    const href = String(url);
    if (href.includes("/identity/v1/oauth2/token")) {
      return Promise.resolve(Response.json({ access_token: "user-token", expires_in: 7200 }));
    }
    const params = new URL(href).searchParams;
    const offset = params.get("offset") ?? "";
    offsets.push(`${(params.get("filter") ?? "").split(":")[0]}@${offset}`);
    const index = Number(offset);
    return Promise.resolve(Response.json({
      total: 2,
      limit: 1,
      offset: index,
      orders: [{
        orderId: `order-${index + 1}`,
        creationDate: "2026-07-03T10:00:00.000Z",
        orderPaymentStatus: "PAID",
        lineItems: [{ lineItemId: "line-1", title: "Unmatched card", quantity: 1, lineItemCost: { value: "10.00", currency: "GBP" } }],
      }],
    }));
  };

  try {
    const result = await syncOwnEbaySales({
      db: fakeEbaySyncDb({ includeListing: false, includeItem: false }).client,
      config: TEST_CONFIG,
      fetchImpl,
      limit: 1,
      now: new Date("2026-07-04T00:00:00.000Z"),
    });
    assert.equal(result.fetchedOrders, 2);
    assert.equal(result.unmatchedCount, 2);
    assert.deepEqual(offsets, ["creationdate@0", "creationdate@1", "lastmodifieddate@0", "lastmodifieddate@1"]);
    assert.equal(result.lateChangesChecked, true);
  } finally {
    restoreEnv("EBAY_CLIENT_ID", savedEnv.clientId);
    restoreEnv("EBAY_CLIENT_SECRET", savedEnv.clientSecret);
    restoreEnv("EBAY_RU_NAME", savedEnv.ruName);
    restoreEnv("EBAY_REFRESH_TOKEN", savedEnv.refreshToken);
  }
});

test("normalizePaidEbayOrder maps paid order lines to GBP pence and import keys", () => {
  const providerOrder = {
    orderId: "01-12345-67890",
    creationDate: "2026-07-03T10:00:00.000Z",
    orderPaymentStatus: "PAID",
    buyer: { username: "synthetic-buyer", userId: "synthetic-account" },
    fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "Synthetic Buyer", contactAddress: { addressLine1: "Synthetic Address" } } } }],
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
  };
  const lines = normalizePaidEbayOrder(providerOrder);

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.importKey, "ebay:01-12345-67890:line-1");
  assert.equal(lines[0]?.buyerPaidPence, 10499);
  assert.equal(lines[0]?.postageChargedPence, 499);
  assert.equal(lines[0]?.paidAt?.toISOString(), "2026-07-03T10:01:00.000Z");
  assert.doesNotMatch(JSON.stringify(lines[0]?.raw), /buyer|address/i);
  assert.deepEqual(lines[0]?.raw, {
    schemaVersion: 1,
    order: {
      orderId: providerOrder.orderId,
      creationDate: providerOrder.creationDate,
      orderPaymentStatus: "PAID",
    },
    line: {
      lineItemId: "line-1", legacyItemId: "1234567890", sku: "pdos-item-1",
      title: "Charizard ex 151 PSA 10", quantity: 1,
    },
  });
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

test("syncOwnEbaySales explains missing fulfillment scope as a reconnect action", async () => {
  const savedEnv = {
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    ruName: process.env.EBAY_RU_NAME,
    refreshToken: process.env.EBAY_REFRESH_TOKEN,
  };
  process.env.EBAY_CLIENT_ID = TEST_CONFIG.clientId;
  process.env.EBAY_CLIENT_SECRET = TEST_CONFIG.clientSecret;
  process.env.EBAY_RU_NAME = TEST_CONFIG.ruName;
  process.env.EBAY_REFRESH_TOKEN = "old-refresh-token";
  let orderCalled = false;
  const fetchImpl: typeof globalThis.fetch = (url) => {
    const href = String(url);
    if (href.includes("/identity/v1/oauth2/token")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: "user-token", expires_in: 7200 }),
        text: () => Promise.resolve("{}"),
      } as Response);
    }
    orderCalled = href.includes("/sell/fulfillment/v1/order");
    return Promise.resolve({
      ok: false,
      status: 403,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(JSON.stringify({
        errors: [
          {
            errorId: 1100,
            message: "Insufficient permissions",
            longMessage: "Insufficient permissions to fulfill the request.",
          },
        ],
      })),
    } as Response);
  };

  try {
    await assert.rejects(
      () => syncOwnEbaySales({ db: fakeEbaySyncDb().client, config: TEST_CONFIG, fetchImpl }),
      /Reconnect eBay to grant new permissions/,
    );
    assert.equal(orderCalled, true);
  } finally {
    restoreEnv("EBAY_CLIENT_ID", savedEnv.clientId);
    restoreEnv("EBAY_CLIENT_SECRET", savedEnv.clientSecret);
    restoreEnv("EBAY_RU_NAME", savedEnv.ruName);
    restoreEnv("EBAY_REFRESH_TOKEN", savedEnv.refreshToken);
  }
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
  assert.equal(db.sales[0]?.costBasis, 70000);
  assert.equal(db.sales[0]?.itemRevenue, 10000);
  assert.equal(db.sales[0]?.costsEstimated, true);
  assert.equal(db.sales[0]?.clientMutationId, `ebay-order:${line.importKey}`);
  db.items[0]!.costBasis = 123;
  assert.equal(db.sales[0]?.costBasis, 70000, "later stock cost edits leave booked sale cost unchanged");
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

test("an eBay sale preserves another active marketplace listing and records removal work", async () => {
  const db = fakeEbaySyncDb();
  db.listings.push({ ...db.listings[0]!, id: "vinted-1", channel: "VINTED", externalRef: "vinted-ref" });
  await importEbayOrderLine(db.client, orderLine());
  assert.equal(db.listings[0]?.state, "SOLD");
  assert.equal(db.listings[1]?.state, "ACTIVE");
  assert.match(db.appAlerts.find((alert) => alert.kind === "REPRICE")?.title, /Remove sold stock/);
});

test("one paid copy of a multi-copy eBay listing leaves its remaining copies active", async () => {
  const db = fakeEbaySyncDb();
  db.items[0]!.quantity = 3;
  await importEbayOrderLine(db.client, orderLine());
  assert.equal(db.items[0]?.quantity, 2);
  assert.equal(db.items[0]?.status, "LISTED");
  assert.equal(db.listings[0]?.state, "ACTIVE");
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
    async $queryRaw(_strings: TemplateStringsArray, itemId: unknown) {
      return items.filter((item) => item.id === itemId).map((item) => ({ id: item.id }));
    },
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
          if (typeof where.id === "string" && listing.id !== where.id) return false;
          if (where.id?.in && !where.id.in.includes(listing.id)) return false;
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

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}


test("multi-unit eBay sale splits exact item revenue and combined shipping once", async () => {
  const db = fakeEbaySyncDb();
  db.items[0]!.quantity = 3;
  await importEbayOrderLine(db.client, orderLine({ quantity: 3, itemSubtotalPence: 10001, postageChargedPence: 499, buyerPaidPence: 10500 }));
  assert.equal(db.sales.length, 3);
  assert.deepEqual(db.sales.map((sale) => sale.itemRevenue), [3334, 3334, 3333]);
  assert.equal(db.sales.reduce((sum, sale) => sum + sale.salePrice, 0), 10500);
  assert.equal(db.sales.reduce((sum, sale) => sum + sale.postage, 0), 499);
  assert.deepEqual(db.sales.map((sale) => sale.mutationIndex), [0, 1, 2]);
  assert.ok(db.sales.every((sale) => sale.costsEstimated && sale.costBasis === 70000 && sale.clientMutationId.startsWith("ebay-order:")));
});

test("normalizePaidEbayOrder does not import fully refunded orders even though the original payment shows PAID", () => {
  assert.deepEqual(
    normalizePaidEbayOrder({
      orderId: "order-refunded",
      orderPaymentStatus: "FULLY_REFUNDED",
      paymentSummary: { payments: [{ paymentStatus: "PAID", paymentDate: "2026-07-03T10:01:00.000Z" }] },
      lineItems: [{ lineItemId: "line-1", sku: "pdos-listing-1", quantity: 1, lineItemCost: { value: "10.00", currency: "GBP" } }],
    }),
    [],
  );
});

test("normalizePaidEbayOrder skips cancelled orders and holds only an open cancellation request", () => {
  const paidLine = { lineItemId: "line-1", sku: "pdos-listing-1", quantity: 1, lineItemCost: { value: "10.00", currency: "GBP" } };
  assert.deepEqual(normalizePaidEbayOrder({
    orderId: "order-cancelled", orderPaymentStatus: "PAID", cancelStatus: { cancelState: "CANCELED" }, lineItems: [paidLine],
  }), []);
  assert.deepEqual(normalizePaidEbayOrder({
    orderId: "order-cancelling", orderPaymentStatus: "PAID",
    cancelStatus: { cancelState: "IN_PROGRESS", cancelRequests: [{ cancelRequestState: "REQUESTED" }] }, lineItems: [paidLine],
  }), []);
  // cancelState stays IN_PROGRESS after the seller rejects the request; the sale stands and must import, as on main.
  assert.equal(normalizePaidEbayOrder({
    orderId: "order-cancel-rejected", orderPaymentStatus: "PAID",
    cancelStatus: { cancelState: "IN_PROGRESS", cancelRequests: [{ cancelRequestState: "REJECTED" }] }, lineItems: [paidLine],
  }).length, 1);
  assert.equal(normalizePaidEbayOrder({
    orderId: "order-cancel-no-detail", orderPaymentStatus: "PAID", cancelStatus: { cancelState: "IN_PROGRESS", cancelRequests: [] }, lineItems: [paidLine],
  }).length, 1);
  assert.equal(normalizePaidEbayOrder({
    orderId: "order-kept", orderPaymentStatus: "PAID", cancelStatus: { cancelState: "NONE_REQUESTED" }, lineItems: [paidLine],
  }).length, 1);
});

test("normalizePaidEbayOrder books a partially refunded order; the sync flags it for a refund check", () => {
  const lines = normalizePaidEbayOrder({
    orderId: "order-partial",
    orderPaymentStatus: "PARTIALLY_REFUNDED",
    paymentSummary: { payments: [{ paymentStatus: "PAID", paymentDate: "2026-07-03T10:01:00.000Z" }] },
    lineItems: [{ lineItemId: "line-1", quantity: 1, lineItemCost: { value: "10.00", currency: "GBP" } }],
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.itemSubtotalPence, 1000);
});

test("normalizePaidEbayOrder books the discounted line cost when a promotion applied", () => {
  const [line] = normalizePaidEbayOrder({
    orderId: "order-promo",
    orderPaymentStatus: "PAID",
    lineItems: [{
      lineItemId: "line-1",
      quantity: 2,
      lineItemCost: { value: "20.00", currency: "GBP" },
      discountedLineItemCost: { value: "18.00", currency: "GBP" },
      deliveryCost: { shippingCost: { value: "1.50", currency: "GBP" } },
    }],
  });
  assert.equal(line?.itemSubtotalPence, 1800);
  assert.equal(line?.postageChargedPence, 150);
  assert.equal(line?.buyerPaidPence, 1950);
});

test("normalizePaidEbayOrder trusts per-line delivery, including free postage on one line", () => {
  const lines = normalizePaidEbayOrder({
    orderId: "order-two-lines",
    orderPaymentStatus: "PAID",
    pricingSummary: { deliveryCost: { value: "3.00", currency: "GBP" } },
    lineItems: [
      { lineItemId: "line-1", quantity: 1, lineItemCost: { value: "10.00", currency: "GBP" }, deliveryCost: { shippingCost: { value: "3.00", currency: "GBP" } } },
      { lineItemId: "line-2", quantity: 1, lineItemCost: { value: "5.00", currency: "GBP" }, deliveryCost: { shippingCost: { value: "0.00", currency: "GBP" } } },
    ],
  });
  assert.deepEqual(lines.map((line) => line.postageChargedPence), [300, 0]);
  assert.equal(lines.reduce((sum, line) => sum + line.buyerPaidPence, 0), 1800, "buyer total matches the order, with postage counted once");
});

test("normalizePaidEbayOrder still splits order-level delivery when lines carry none", () => {
  const lines = normalizePaidEbayOrder({
    orderId: "order-order-level-postage",
    orderPaymentStatus: "PAID",
    pricingSummary: { deliveryCost: { value: "3.01", currency: "GBP" } },
    lineItems: [
      { lineItemId: "line-1", quantity: 1, lineItemCost: { value: "10.00", currency: "GBP" } },
      { lineItemId: "line-2", quantity: 1, lineItemCost: { value: "5.00", currency: "GBP" } },
    ],
  });
  assert.deepEqual(lines.map((line) => line.postageChargedPence), [151, 150]);
});

test("a non-GBP eBay order line is held for review instead of booking a zero-value sale", async () => {
  const [line] = normalizePaidEbayOrder({
    orderId: "order-usd",
    orderPaymentStatus: "PAID",
    lineItems: [{ lineItemId: "line-1", sku: "pdos-listing-1", quantity: 1, lineItemCost: { value: "12.00", currency: "USD" } }],
  });
  assert.ok(line);
  const db = fakeEbaySyncDb();
  const result = await importEbayOrderLine(db.client, line);
  assert.equal(result.status, "UNMATCHED");
  assert.match(result.reason ?? "", /GBP/);
  assert.equal(db.sales.length, 0);
  assert.equal(db.items[0]?.status, "LISTED");
  assert.equal(db.listings[0]?.state, "ACTIVE");
});

test("syncOwnEbaySales flags an already-imported sale whose eBay order was later cancelled or refunded", async () => {
  const savedEnv = {
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    ruName: process.env.EBAY_RU_NAME,
    refreshToken: process.env.EBAY_REFRESH_TOKEN,
  };
  process.env.EBAY_CLIENT_ID = TEST_CONFIG.clientId;
  process.env.EBAY_CLIENT_SECRET = TEST_CONFIG.clientSecret;
  process.env.EBAY_RU_NAME = TEST_CONFIG.ruName;
  process.env.EBAY_REFRESH_TOKEN = "refresh-token";
  const db = fakeEbaySyncDb();
  await importEbayOrderLine(db.client, orderLine());
  assert.equal(db.sales.length, 1);
  const fetchImpl: typeof globalThis.fetch = (url) => {
    if (String(url).includes("/identity/v1/oauth2/token")) {
      return Promise.resolve(Response.json({ access_token: "user-token", expires_in: 7200 }));
    }
    return Promise.resolve(Response.json({
      total: 1,
      limit: 25,
      offset: 0,
      orders: [{
        orderId: "order-1",
        creationDate: "2026-07-03T10:00:00.000Z",
        orderPaymentStatus: "FULLY_REFUNDED",
        cancelStatus: { cancelState: "CANCELED" },
        paymentSummary: { payments: [{ paymentStatus: "PAID" }] },
        lineItems: [{ lineItemId: "line-1", sku: "pdos-listing-1", title: "Charizard ex 151 PSA 10", quantity: 1, lineItemCost: { value: "100.00", currency: "GBP" } }],
      }],
    }));
  };

  try {
    const first = await syncOwnEbaySales({ db: db.client, config: TEST_CONFIG, fetchImpl });
    const second = await syncOwnEbaySales({ db: db.client, config: TEST_CONFIG, fetchImpl });
    const third = await syncOwnEbaySales({ db: db.client, config: TEST_CONFIG, fetchImpl });
    assert.deepEqual([first.reversedCount, second.reversedCount, third.reversedCount], [1, 0, 0], "only the first sync counts the reversal");
    assert.match(db.imports[0]?.reason ?? "", /Cancelled or refunded in full on eBay after import/);
    assert.equal(first.matchedCount, 0);
    assert.equal(db.sales.length, 1, "no new sale is booked for the reversed order");
    const reversals = db.appAlerts.filter((alert) => alert.sourceKey === "ebay-reversal:ebay:order-1:line-1");
    assert.equal(reversals.length, 1, "repeat syncs keep one alert");
    assert.match(reversals[0]?.title ?? "", /cancelled or refunded/i);
    assert.equal(reversals[0]?.kind, "EBAY_SALE");
  } finally {
    restoreEnv("EBAY_CLIENT_ID", savedEnv.clientId);
    restoreEnv("EBAY_CLIENT_SECRET", savedEnv.clientSecret);
    restoreEnv("EBAY_RU_NAME", savedEnv.ruName);
    restoreEnv("EBAY_REFRESH_TOKEN", savedEnv.refreshToken);
  }
});

// ---- Review follow-ups (PR #26): totals reconcile to eBay's own order figures ----

async function withEbayEnv<T>(fn: () => Promise<T>): Promise<T> {
  const keys = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RU_NAME", "EBAY_REFRESH_TOKEN"] as const;
  const saved = keys.map((key) => process.env[key]);
  process.env.EBAY_CLIENT_ID = TEST_CONFIG.clientId;
  process.env.EBAY_CLIENT_SECRET = TEST_CONFIG.clientSecret;
  process.env.EBAY_RU_NAME = TEST_CONFIG.ruName;
  process.env.EBAY_REFRESH_TOKEN = "refresh-token";
  try {
    return await fn();
  } finally {
    keys.forEach((key, index) => restoreEnv(key, saved[index]));
  }
}

/** A fake Fulfillment API that applies the date filter it is sent, like eBay does. */
function ordersFetch(orders: Array<Record<string, unknown>>, options: { failModifiedRead?: boolean } = {}): typeof globalThis.fetch {
  return (url) => {
    const href = String(url);
    if (href.includes("/identity/v1/oauth2/token")) return Promise.resolve(Response.json({ access_token: "user-token", expires_in: 7200 }));
    const match = /^(creationdate|lastmodifieddate):\[(.+)\.\.(.+)\]$/.exec(new URL(href).searchParams.get("filter") ?? "");
    if (!match) return Promise.resolve(Response.json({ errors: [{ message: "bad filter" }] }, { status: 400 }));
    if (match[1] === "lastmodifieddate" && options.failModifiedRead) return Promise.resolve(Response.json({ errors: [{ message: "unavailable" }] }, { status: 500 }));
    const from = Date.parse(match[2]!);
    const to = Date.parse(match[3]!);
    const inRange = orders.filter((order) => {
      const at = Date.parse(String(match[1] === "creationdate" ? order.creationDate : order.lastModifiedDate ?? order.creationDate));
      return at >= from && at <= to;
    });
    return Promise.resolve(Response.json({ total: inRange.length, limit: 25, offset: 0, orders: inRange }));
  };
}

const gbp = (value: string) => ({ value, currency: "GBP" });

test("per-line postage is reconciled to the order delivery total when a line reports none", () => {
  const lines = normalizePaidEbayOrder({
    orderId: "order-mixed-postage",
    orderPaymentStatus: "PAID",
    pricingSummary: { deliveryCost: gbp("5.00") },
    lineItems: [
      { lineItemId: "line-1", quantity: 1, lineItemCost: gbp("10.00"), deliveryCost: { shippingCost: gbp("3.00") } },
      { lineItemId: "line-2", quantity: 1, lineItemCost: gbp("5.00") },
    ],
  });
  assert.equal(lines.reduce((sum, line) => sum + line.postageChargedPence, 0), 500, "no postage is dropped");
  assert.equal(lines.reduce((sum, line) => sum + line.buyerPaidPence, 0), 2000);
});

test("combined postage is booked once, not once per line", () => {
  const lines = normalizePaidEbayOrder({
    orderId: "order-combined-postage",
    orderPaymentStatus: "PAID",
    pricingSummary: { deliveryCost: gbp("3.00"), total: gbp("18.00") },
    lineItems: [
      { lineItemId: "line-1", quantity: 1, lineItemCost: gbp("10.00"), deliveryCost: { shippingCost: gbp("3.00") } },
      { lineItemId: "line-2", quantity: 1, lineItemCost: gbp("5.00"), deliveryCost: { shippingCost: gbp("3.00") } },
    ],
  });
  assert.deepEqual(lines.map((line) => line.postageChargedPence), [150, 150]);
  assert.equal(lines.reduce((sum, line) => sum + line.buyerPaidPence, 0), 1800, "no phantom revenue");
});

test("multi-line orders always book exactly the order's delivery and discounted item totals", () => {
  let seed = 11;
  const next = (max: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max; };
  const money = (pence: number) => gbp((pence / 100).toFixed(2));
  for (let round = 0; round < 1500; round += 1) {
    const count = 1 + next(6);
    const listed = Array.from({ length: count }, () => 100 + next(50_000));
    const subtotal = listed.reduce((sum, pence) => sum + pence, 0);
    const delivery = next(3) === 0 ? 0 : next(2_000);
    const deliveryDiscount = next(3) === 0 ? next(delivery + 1) : 0;
    const discount = next(3) === 0 ? next(subtotal) : 0;
    const lineItems = listed.map((pence, index) => ({
      lineItemId: `line-${index}`,
      quantity: 1 + next(3),
      lineItemCost: money(pence),
      // Lines report delivery in several inconsistent ways: none, zero, per line, or the whole order's figure.
      ...(next(4) === 0 ? {} : { deliveryCost: {
        shippingCost: money([0, next(800), delivery][next(3)]!),
        ...(next(3) === 0 ? { discountAmount: gbp(`-${(next(300) / 100).toFixed(2)}`) } : {}),
      } }),
    }));
    const lines = normalizePaidEbayOrder({
      orderId: `order-property-${round}`,
      orderPaymentStatus: "PAID",
      pricingSummary: {
        priceSubtotal: money(subtotal),
        deliveryCost: money(delivery),
        ...(deliveryDiscount ? { deliveryDiscount: gbp(`-${(deliveryDiscount / 100).toFixed(2)}`) } : {}),
        ...(discount ? { priceDiscount: gbp(`-${(discount / 100).toFixed(2)}`) } : {}),
      },
      lineItems,
    });
    assert.equal(lines.length, count);
    assert.equal(lines.reduce((sum, line) => sum + line.postageChargedPence, 0), delivery - deliveryDiscount, `round ${round}: postage`);
    assert.equal(lines.reduce((sum, line) => sum + line.itemSubtotalPence, 0), subtotal - discount, `round ${round}: items`);
    assert.ok(lines.every((line) => line.buyerPaidPence === line.itemSubtotalPence + line.postageChargedPence && line.itemSubtotalPence >= 0));
  }
});

test("an order-level discount without per-line discounted costs reduces the booked item amount", () => {
  const [line] = normalizePaidEbayOrder({
    orderId: "order-order-discount",
    orderPaymentStatus: "PAID",
    pricingSummary: { priceSubtotal: gbp("10.00"), priceDiscount: gbp("-2.00") },
    lineItems: [{ lineItemId: "line-1", quantity: 1, lineItemCost: gbp("10.00") }],
  });
  assert.equal(line?.itemSubtotalPence, 800);
  assert.equal(line?.buyerPaidPence, 800);
});

test("a 100% discounted line books 0 for the item and does not double-count postage", () => {
  const [line] = normalizePaidEbayOrder({
    orderId: "order-free-item",
    orderPaymentStatus: "PAID",
    lineItems: [{
      lineItemId: "line-1",
      quantity: 1,
      lineItemCost: gbp("5.00"),
      discountedLineItemCost: gbp("0.00"),
      total: gbp("3.00"),
      deliveryCost: { shippingCost: gbp("3.00") },
    }],
  });
  assert.equal(line?.itemSubtotalPence, 0);
  assert.equal(line?.postageChargedPence, 300);
  assert.equal(line?.buyerPaidPence, 300);
});

test("a line refunded in full inside a multi-line order is not booked and is signalled as a reversal", () => {
  const order = {
    orderId: "order-one-returned",
    orderPaymentStatus: "PARTIALLY_REFUNDED",
    paymentSummary: { payments: [{ paymentStatus: "PAID" }] },
    pricingSummary: { deliveryCost: gbp("0.00") },
    lineItems: [
      { lineItemId: "line-1", quantity: 1, lineItemCost: gbp("10.00") },
      { lineItemId: "line-2", quantity: 1, lineItemCost: gbp("20.00"), refunds: [{ amount: gbp("20.00") }] },
      { lineItemId: "line-3", quantity: 1, lineItemCost: gbp("30.00") },
    ],
  };
  assert.deepEqual(normalizePaidEbayOrder(order).map((line) => line.lineItemId), ["line-1", "line-3"]);
  assert.deepEqual(ebayOrderLineSignals(order).map((signal) => [signal.importKey, signal.kind]), [["ebay:order-one-returned:line-2", "reversed"]]);
});

test("a partly refunded line is booked and signalled; an order-level partial refund signals every line", () => {
  const lineRefund = {
    orderId: "order-line-partial",
    orderPaymentStatus: "PARTIALLY_REFUNDED",
    paymentSummary: { payments: [{ paymentStatus: "PAID" }] },
    lineItems: [
      { lineItemId: "line-1", quantity: 1, lineItemCost: gbp("10.00"), refunds: [{ amount: gbp("4.00") }] },
      { lineItemId: "line-2", quantity: 1, lineItemCost: gbp("20.00") },
    ],
  };
  assert.equal(normalizePaidEbayOrder(lineRefund).length, 2);
  assert.deepEqual(ebayOrderLineSignals(lineRefund).map((signal) => [signal.importKey, signal.kind]), [["ebay:order-line-partial:line-1", "partial-refund"]]);
  const orderRefund = { ...lineRefund, orderId: "order-order-partial", lineItems: lineRefund.lineItems.map(({ refunds: _refunds, ...line }) => line) };
  assert.deepEqual(ebayOrderLineSignals(orderRefund).map((signal) => signal.kind), ["partial-refund", "partial-refund"]);
});

test("syncOwnEbaySales books a partly refunded order once and raises one refund alert, also when the refund comes later", async () => {
  await withEbayEnv(async () => {
    const paid = {
      orderId: "order-1",
      creationDate: "2026-07-03T10:00:00.000Z",
      orderPaymentStatus: "PAID",
      paymentSummary: { payments: [{ paymentStatus: "PAID" }] },
      lineItems: [{ lineItemId: "line-1", sku: "pdos-listing-1", title: "Charizard ex 151 PSA 10", quantity: 1, lineItemCost: gbp("100.00") }],
    };
    const refunded = { ...paid, orderPaymentStatus: "PARTIALLY_REFUNDED", lineItems: [{ ...paid.lineItems[0]!, refunds: [{ amount: gbp("15.00") }] }] };
    const now = new Date("2026-07-05T00:00:00.000Z");
    const db = fakeEbaySyncDb();
    const first = await syncOwnEbaySales({ db: db.client, config: TEST_CONFIG, fetchImpl: ordersFetch([paid]), now });
    const second = await syncOwnEbaySales({ db: db.client, config: TEST_CONFIG, fetchImpl: ordersFetch([refunded]), now });
    const third = await syncOwnEbaySales({ db: db.client, config: TEST_CONFIG, fetchImpl: ordersFetch([refunded]), now });
    assert.equal(first.matchedCount, 1);
    assert.deepEqual([first.partialRefundCount, second.partialRefundCount, third.partialRefundCount], [0, 1, 0]);
    assert.equal(db.sales.length, 1, "the refund never books a second sale");
    assert.equal(db.appAlerts.filter((alert) => alert.sourceKey === "ebay-partial-refund:ebay:order-1:line-1").length, 1);
    assert.match(db.imports[0]?.reason ?? "", /refund/i);

    // Partly refunded at first sight: booked and flagged in the same sync.
    const fresh = fakeEbaySyncDb();
    const once = await syncOwnEbaySales({ db: fresh.client, config: TEST_CONFIG, fetchImpl: ordersFetch([refunded]), now });
    assert.deepEqual([once.matchedCount, once.partialRefundCount], [1, 1]);
  });
});

test("a cancelled order leaves the manual queue instead of inviting a hand-booked sale", async () => {
  await withEbayEnv(async () => {
    const order = {
      orderId: "order-unmatched",
      creationDate: "2026-07-03T10:00:00.000Z",
      orderPaymentStatus: "PAID",
      lineItems: [{ lineItemId: "line-1", sku: "pdos-missing", title: "Unknown card", quantity: 1, lineItemCost: gbp("12.00") }],
    };
    const now = new Date("2026-07-05T00:00:00.000Z");
    const db = fakeEbaySyncDb({ includeListing: false, includeItem: false });
    await syncOwnEbaySales({ db: db.client, config: TEST_CONFIG, fetchImpl: ordersFetch([order]), now });
    assert.equal(db.imports[0]?.status, "UNMATCHED");
    const cancelled = await syncOwnEbaySales({
      db: db.client, config: TEST_CONFIG, now,
      fetchImpl: ordersFetch([{ ...order, cancelStatus: { cancelState: "CANCELED" } }]),
    });
    assert.equal(db.imports[0]?.status, "SKIPPED");
    assert.match(db.imports[0]?.reason ?? "", /no sale to record/i);
    assert.equal(cancelled.reversedCount, 0, "nothing was booked, so nothing was reversed");
    assert.equal(db.sales.length, 0);
  });
});

test("an order created before the window is never imported, but its later refund is still flagged", async () => {
  await withEbayEnv(async () => {
    const db = fakeEbaySyncDb();
    await importEbayOrderLine(db.client, orderLine());
    const oldButRefunded = {
      orderId: "order-1",
      creationDate: "2026-06-01T10:00:00.000Z",
      lastModifiedDate: "2026-07-04T10:00:00.000Z",
      orderPaymentStatus: "FULLY_REFUNDED",
      paymentSummary: { payments: [{ paymentStatus: "PAID" }] },
      lineItems: [{ lineItemId: "line-1", sku: "pdos-listing-1", quantity: 1, lineItemCost: gbp("104.99") }],
    };
    const oldUnseen = { ...oldButRefunded, orderId: "order-old-paid", orderPaymentStatus: "PAID", lineItems: [{ lineItemId: "line-9", sku: "pdos-item-1", quantity: 1, lineItemCost: gbp("50.00") }] };
    const result = await syncOwnEbaySales({ db: db.client, config: TEST_CONFIG, fetchImpl: ordersFetch([oldButRefunded, oldUnseen]), now: new Date("2026-07-05T00:00:00.000Z") });
    assert.equal(result.lateChangesChecked, true);
    assert.equal(result.reversedCount, 1);
    assert.equal(result.imports.length, 0, "orders created before the window are not imported");
    assert.equal(db.sales.length, 1);
  });
});

test("held non-GBP rows store no pence amounts but keep eBay's own figures for manual entry", async () => {
  const [line] = normalizePaidEbayOrder({
    orderId: "order-eur",
    orderPaymentStatus: "PAID",
    lineItems: [{ lineItemId: "line-1", sku: "pdos-listing-1", quantity: 1, lineItemCost: { value: "14.00", currency: "EUR" } }],
  });
  assert.ok(line);
  const db = fakeEbaySyncDb();
  await importEbayOrderLine(db.client, line);
  assert.equal(db.imports[0]?.status, "UNMATCHED");
  assert.equal(db.imports[0]?.buyerPaidPence, null);
  assert.equal(db.imports[0]?.postageChargedPence, null);
  assert.deepEqual(db.imports[0]?.payload?.heldAmounts?.lineItemCost, { value: "14.00", currency: "EUR" });
});

// ---- Verification follow-ups: delivery discounts, eBay's own line totals, signals never block imports ----

test("an order-level delivery discount is taken off the booked postage", () => {
  const lines = normalizePaidEbayOrder({
    orderId: "order-delivery-discount",
    orderPaymentStatus: "PAID",
    pricingSummary: { priceSubtotal: gbp("14.00"), deliveryCost: gbp("3.50"), deliveryDiscount: gbp("-2.00"), total: gbp("15.50") },
    lineItems: [
      { lineItemId: "line-1", quantity: 1, lineItemCost: gbp("10.00"), deliveryCost: { shippingCost: gbp("2.00"), discountAmount: gbp("-2.00") }, total: gbp("10.00") },
      { lineItemId: "line-2", quantity: 1, lineItemCost: gbp("4.00"), deliveryCost: { shippingCost: gbp("1.50") }, total: gbp("5.50") },
    ],
  });
  assert.deepEqual(lines.map((line) => line.postageChargedPence), [0, 150]);
  assert.equal(lines.reduce((sum, line) => sum + line.buyerPaidPence, 0), 1550, "matches eBay's order total");
});

test("a line refunded for eBay's own line total is a reversal even when postage was reallocated", () => {
  const order = {
    orderId: "order-refund-vs-total",
    orderPaymentStatus: "PARTIALLY_REFUNDED",
    paymentSummary: { payments: [{ paymentStatus: "PAID" }] },
    pricingSummary: { deliveryCost: gbp("3.00") },
    lineItems: [
      // eBay's line total includes 3.00 postage; the order's single 3.00 delivery is shared across lines here.
      { lineItemId: "line-1", quantity: 1, lineItemCost: gbp("10.00"), deliveryCost: { shippingCost: gbp("3.00") }, total: gbp("13.00"), refunds: [{ amount: gbp("13.00") }] },
      { lineItemId: "line-2", quantity: 1, lineItemCost: gbp("5.00"), deliveryCost: { shippingCost: gbp("3.00") }, total: gbp("8.00") },
    ],
  };
  assert.deepEqual(ebayOrderLineSignals(order).map((signal) => signal.kind), ["reversed"]);
  assert.deepEqual(normalizePaidEbayOrder(order).map((line) => line.lineItemId), ["line-2"]);

  // A refund that only covers the app's smaller postage share is still a partial refund of eBay's line.
  const partial = { ...order, lineItems: [{ ...order.lineItems[0]!, refunds: [{ amount: gbp("11.50") }] }, order.lineItems[1]!] };
  assert.deepEqual(ebayOrderLineSignals(partial).map((signal) => signal.kind), ["partial-refund"]);
  assert.equal(normalizePaidEbayOrder(partial).length, 2);
});

test("imports still run when the extra read for older orders fails", async () => {
  await withEbayEnv(async () => {
    const db = fakeEbaySyncDb();
    const order = {
      orderId: "order-1",
      creationDate: "2026-07-03T10:00:00.000Z",
      orderPaymentStatus: "PAID",
      lineItems: [{ lineItemId: "line-1", sku: "pdos-listing-1", quantity: 1, lineItemCost: gbp("100.00") }],
    };
    const result = await syncOwnEbaySales({
      db: db.client, config: TEST_CONFIG, now: new Date("2026-07-05T00:00:00.000Z"),
      fetchImpl: ordersFetch([order], { failModifiedRead: true }),
    });
    assert.equal(result.matchedCount, 1);
    assert.equal(result.lateChangesChecked, false);
    assert.equal(db.sales.length, 1);
  });
});

test("a partly refunded line in the manual queue shows its refund note in the sync result", async () => {
  await withEbayEnv(async () => {
    const db = fakeEbaySyncDb({ includeListing: false, includeItem: false });
    const order = {
      orderId: "order-queue-refund",
      creationDate: "2026-07-03T10:00:00.000Z",
      orderPaymentStatus: "PARTIALLY_REFUNDED",
      paymentSummary: { payments: [{ paymentStatus: "PAID" }] },
      lineItems: [{ lineItemId: "line-1", sku: "pdos-missing", quantity: 1, lineItemCost: gbp("20.00"), total: gbp("20.00"), refunds: [{ amount: gbp("5.00") }] }],
    };
    const result = await syncOwnEbaySales({ db: db.client, config: TEST_CONFIG, now: new Date("2026-07-05T00:00:00.000Z"), fetchImpl: ordersFetch([order]) });
    assert.equal(result.imports[0]?.status, "UNMATCHED");
    assert.match(result.imports[0]?.reason ?? "", /No Poke Deal stock row.*Check the refunded amount/);
    assert.equal(db.sales.length, 0);
  });
});

test("reversal alert copy is true for a multi-copy stock row that stays listed", async () => {
  await withEbayEnv(async () => {
    const db = fakeEbaySyncDb();
    db.items[0]!.quantity = 3;
    const paid = {
      orderId: "order-1",
      creationDate: "2026-07-03T10:00:00.000Z",
      orderPaymentStatus: "PAID",
      lineItems: [{ lineItemId: "line-1", sku: "pdos-listing-1", title: "Charizard ex 151 PSA 10", quantity: 1, lineItemCost: gbp("100.00") }],
    };
    const now = new Date("2026-07-05T00:00:00.000Z");
    await syncOwnEbaySales({ db: db.client, config: TEST_CONFIG, now, fetchImpl: ordersFetch([paid]) });
    assert.equal(db.items[0]?.status, "LISTED");
    const result = await syncOwnEbaySales({ db: db.client, config: TEST_CONFIG, now, fetchImpl: ordersFetch([{ ...paid, cancelStatus: { cancelState: "CANCELED" } }]) });
    assert.equal(result.reversedCount, 1);
    const alert = db.appAlerts.find((row) => row.sourceKey === "ebay-reversal:ebay:order-1:line-1");
    assert.doesNotMatch(alert?.message ?? "", /marked sold|relist/i);
    assert.match(alert?.message ?? "", /stock was reduced/);
  });
});
