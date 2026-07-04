import { createInboxAlert } from "../alerts/inbox.js";
import { estimateSaleCosts } from "../dealer/saleFees.js";
import { planSaleListingClosure, planUnitSale, splitPence } from "../dealer/unitSale.js";
import type { EbayConfig } from "./config.js";
import { getEbayConfig, isEbayConfigured } from "./config.js";
import { resolveEbayRefreshToken } from "./credentials.js";
import { ebayJson } from "./client.js";
import { ebayErrorMessage } from "./errors.js";
import { getAccessTokenWithSource } from "./tokens.js";

export type EbayOrderImportStatus = "MATCHED" | "UNMATCHED" | "SKIPPED";

export type EbayMoney = {
  value?: string;
  currency?: string;
};

export type EbayFulfillmentLineItem = {
  lineItemId?: string;
  legacyItemId?: string;
  sku?: string;
  title?: string;
  quantity?: number;
  lineItemCost?: EbayMoney;
  total?: EbayMoney;
  deliveryCost?: { shippingCost?: EbayMoney; importCharges?: EbayMoney } | EbayMoney;
};

export type EbayFulfillmentOrder = {
  orderId?: string;
  creationDate?: string;
  lastModifiedDate?: string;
  orderPaymentStatus?: string;
  orderFulfillmentStatus?: string;
  pricingSummary?: {
    priceSubtotal?: EbayMoney;
    deliveryCost?: EbayMoney;
    total?: EbayMoney;
  };
  paymentSummary?: {
    payments?: Array<{ paymentStatus?: string; paymentDate?: string; amount?: EbayMoney }>;
    totalDueSeller?: EbayMoney;
  };
  lineItems?: EbayFulfillmentLineItem[];
};

type EbayFulfillmentOrdersResponse = {
  orders?: EbayFulfillmentOrder[];
  total?: number;
  limit?: number;
  offset?: number;
};

export type NormalizedEbayOrderLine = {
  importKey: string;
  orderId: string;
  lineItemId: string | null;
  sku: string | null;
  ebayItemId: string | null;
  title: string | null;
  quantity: number;
  orderCreatedAt: Date | null;
  paidAt: Date | null;
  itemSubtotalPence: number;
  postageChargedPence: number;
  buyerPaidPence: number;
  raw: unknown;
};

export type EbayOrderImportSummary = {
  importKey: string;
  orderId: string;
  lineItemId: string | null;
  sku: string | null;
  ebayItemId: string | null;
  title: string | null;
  status: EbayOrderImportStatus;
  reason: string | null;
  itemId: string | null;
  listingId: string | null;
  saleId: string | null;
  buyerPaidPence: number | null;
  postageChargedPence: number | null;
  feesEstimatePence: number | null;
};

export type EbaySalesSyncResult = {
  ok: boolean;
  checkedAt: string;
  skipped: boolean;
  reason?: string;
  fetchedOrders: number;
  matchedCount: number;
  unmatchedCount: number;
  skippedCount: number;
  imports: EbayOrderImportSummary[];
};

type ListingMatch = {
  listingId: string | null;
  itemId: string;
  item: {
    id: string;
    quantity: number;
    status: "IN_STOCK" | "LISTED" | "SOLD" | "RESERVED";
    grade: string;
    costBasis: number;
    card: { name: string; setName: string; number: string | null };
  };
};

type EbaySalesSyncDb = {
  $transaction<T>(fn: (tx: EbaySalesSyncDb) => Promise<T>): Promise<T>;
  ebayOrderImport: {
    findUnique(args: any): Promise<any | null>;
    findMany(args: any): Promise<any[]>;
    create(args: any): Promise<any>;
    update(args: any): Promise<any>;
    upsert(args: any): Promise<any>;
  };
  listing: {
    findUnique(args: any): Promise<any | null>;
    findFirst(args: any): Promise<any | null>;
    updateMany(args: any): Promise<{ count: number }>;
  };
  inventoryItem: {
    findUnique(args: any): Promise<any | null>;
    update(args: any): Promise<any>;
  };
  sale: {
    create(args: any): Promise<any>;
  };
  appAlert: {
    create(args: any): Promise<any>;
    upsert(args: any): Promise<any>;
  };
};

export async function syncOwnEbaySales({
  db,
  since,
  now = new Date(),
  limit = 25,
  config = getEbayConfig(),
  fetchImpl = fetch,
}: {
  db: EbaySalesSyncDb;
  since?: Date;
  now?: Date;
  limit?: number;
  config?: EbayConfig | null;
  fetchImpl?: typeof fetch;
}): Promise<EbaySalesSyncResult> {
  if (!isEbayConfigured() || !config) {
    return emptySyncResult(now, "eBay is not connected.");
  }
  const refreshToken = await resolveEbayRefreshToken({
    db: "ebayCredential" in db ? db as any : null,
  }).catch(() => null);
  if (!refreshToken) return emptySyncResult(now, "eBay is not connected.");

  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  let response: EbayFulfillmentOrdersResponse;
  try {
    const { accessToken } = await getAccessTokenWithSource(config, fetchImpl, { refreshToken });
    const path = buildFulfillmentOrdersPath({
      since: since ?? new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
      until: now,
      limit: safeLimit,
    });
    response = await ebayJson<EbayFulfillmentOrdersResponse>(
      config,
      path,
      accessToken,
      { marketplaceId: config.marketplaceId },
      fetchImpl,
    );
  } catch (err) {
    throw new Error(ebayErrorMessage(err, "eBay sales sync failed"));
  }
  const orders = response.orders ?? [];
  const lines = orders.flatMap(normalizePaidEbayOrder);
  const imports: EbayOrderImportSummary[] = [];

  for (const line of lines) {
    imports.push(await importEbayOrderLine(db, line));
  }

  return {
    ok: true,
    checkedAt: now.toISOString(),
    skipped: false,
    fetchedOrders: orders.length,
    matchedCount: imports.filter((row) => row.status === "MATCHED").length,
    unmatchedCount: imports.filter((row) => row.status === "UNMATCHED").length,
    skippedCount: imports.filter((row) => row.status === "SKIPPED").length,
    imports,
  };
}

export function buildFulfillmentOrdersPath({
  since,
  until,
  limit = 25,
}: {
  since: Date;
  until: Date;
  limit?: number;
}): string {
  const filter = `creationdate:[${since.toISOString()}..${until.toISOString()}]`;
  const params = new URLSearchParams({
    filter,
    limit: String(Math.max(1, Math.min(100, Math.floor(limit)))),
  });
  return `/sell/fulfillment/v1/order?${params.toString()}`;
}

export function normalizePaidEbayOrder(order: EbayFulfillmentOrder): NormalizedEbayOrderLine[] {
  const orderId = order.orderId?.trim();
  if (!orderId || !isPaidOrder(order)) return [];

  const orderPostagePence = moneyToGbpPence(order.pricingSummary?.deliveryCost);
  const lines = order.lineItems ?? [];
  const postageParts = splitPence(orderPostagePence, Math.max(1, lines.length));

  return lines.map((line, index) => {
    const lineItemId = line.lineItemId?.trim() || null;
    const itemSubtotalPence = moneyToGbpPence(line.lineItemCost) || moneyToGbpPence(line.total);
    const postageChargedPence = lineDeliveryPence(line) || postageParts[index] || 0;
    const buyerPaidPence = itemSubtotalPence + postageChargedPence;
    const orderCreatedAt = parseDate(order.creationDate);
    const paidAt = parseDate(order.paymentSummary?.payments?.find((payment) => isPaidStatus(payment.paymentStatus))?.paymentDate) ?? orderCreatedAt;

    return {
      importKey: `ebay:${orderId}:${lineItemId ?? line.legacyItemId ?? index}`,
      orderId,
      lineItemId,
      sku: line.sku?.trim() || null,
      ebayItemId: line.legacyItemId?.trim() || null,
      title: line.title?.trim() || null,
      quantity: Math.max(1, Math.floor(line.quantity ?? 1)),
      orderCreatedAt,
      paidAt,
      itemSubtotalPence,
      postageChargedPence,
      buyerPaidPence,
      raw: { order, line },
    };
  });
}

export async function importEbayOrderLine(
  db: EbaySalesSyncDb,
  line: NormalizedEbayOrderLine,
): Promise<EbayOrderImportSummary> {
  return db.$transaction(async (tx) => {
    const existing = await tx.ebayOrderImport.findUnique({ where: { importKey: line.importKey } });
    if (existing?.saleId || existing?.status === "MATCHED") {
      return summarizeImport(existing, "SKIPPED", "Already imported.");
    }

    const match = await findListingMatch(tx, line);
    if (!match) {
      const row = await upsertImport(tx, line, {
        status: "UNMATCHED",
        reason: line.sku ? "No Poke Deal stock row matched this eBay SKU." : "eBay order line had no SKU to match.",
      });
      return summarizeImport(row);
    }

    const item = await tx.inventoryItem.findUnique({
      where: { id: match.itemId },
      include: { card: true },
    });
    if (!item) {
      const row = await upsertImport(tx, line, {
        status: "UNMATCHED",
        reason: "Matched stock row no longer exists.",
        itemId: match.itemId,
        listingId: match.listingId,
      });
      return summarizeImport(row);
    }

    let salePlan;
    try {
      salePlan = planUnitSale({
        quantity: item.quantity,
        soldQuantity: line.quantity,
        status: item.status,
      });
    } catch (err) {
      const row = await upsertImport(tx, line, {
        status: "UNMATCHED",
        reason: err instanceof Error ? err.message : "Could not mark matched stock as sold.",
        itemId: item.id,
        listingId: match.listingId,
      });
      return summarizeImport(row);
    }

    const feesEstimate = estimateSaleCosts("EBAY", line.buyerPaidPence, { grade: item.grade });
    const salePrices = splitPence(line.buyerPaidPence, salePlan.soldQuantity);
    const fees = splitPence(feesEstimate.feesPence, salePlan.soldQuantity);
    const postage = splitPence(feesEstimate.postagePence, salePlan.soldQuantity);
    const soldAt = line.paidAt ?? line.orderCreatedAt ?? new Date();
    const sales = [];

    for (let index = 0; index < salePlan.soldQuantity; index += 1) {
      sales.push(
        await tx.sale.create({
          data: {
            itemId: item.id,
            channel: "EBAY",
            salePrice: salePrices[index] ?? 0,
            fees: fees[index] ?? 0,
            postage: postage[index] ?? 0,
            soldAt,
          },
        }),
      );
    }

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantity: salePlan.remainingQuantity,
        status: salePlan.status,
      },
    });

    const listingClosure = planSaleListingClosure({
      itemId: item.id,
      soldListingId: match.listingId,
      closeOpenListings: salePlan.closeOpenListings,
    });
    if (listingClosure?.kind === "all-open") {
      await tx.listing.updateMany({
        where: { itemId: listingClosure.itemId, state: { in: ["DRAFT", "ACTIVE"] } },
        data: { state: "SOLD", endedAt: soldAt },
      });
    } else if (listingClosure?.kind === "one") {
      await tx.listing.updateMany({
        where: { id: listingClosure.listingId, itemId: listingClosure.itemId, state: { in: ["DRAFT", "ACTIVE"] } },
        data: { state: "SOLD", endedAt: soldAt },
      });
    }

    const saved = await upsertImport(tx, line, {
      status: "MATCHED",
      reason: "Imported from eBay order.",
      itemId: item.id,
      listingId: match.listingId,
      saleId: sales[0]?.id ?? null,
      feesEstimatePence: feesEstimate.feesPence,
    });

    await createInboxAlert(tx as any, {
      kind: "EBAY_SALE",
      title: `eBay sale imported: ${item.card.name}`,
      message: `${item.card.setName}${item.card.number ? ` #${item.card.number}` : ""} sold for ${formatGbp(line.buyerPaidPence)}. Fees are estimated until payout reconciliation is added.`,
      pence: line.buyerPaidPence,
      href: "/?view=listings",
      sourceKey: `ebay-sale:${line.importKey}`,
    });

    return summarizeImport(saved);
  });
}

export async function readEbayOrderImportQueue(
  db: Pick<EbaySalesSyncDb, "ebayOrderImport">,
  { status, take = 20 }: { status?: EbayOrderImportStatus; take?: number } = {},
): Promise<EbayOrderImportSummary[]> {
  const rows = await db.ebayOrderImport.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(50, Math.floor(take))),
  });
  return rows.map((row) => summarizeImport(row));
}

async function findListingMatch(db: EbaySalesSyncDb, line: NormalizedEbayOrderLine): Promise<ListingMatch | null> {
  const appId = parsePokeDealSku(line.sku);
  if (appId) {
    const listing = await findListingById(db, appId);
    if (listing) return listingToMatch(listing);

    const item = await findItemById(db, appId);
    if (item) return itemToMatch(item);
  }

  if (line.ebayItemId) {
    const listing = await db.listing.findFirst({
      where: { channel: "EBAY", externalRef: line.ebayItemId },
      include: { item: { include: { card: true } } },
    });
    if (listing) return listingToMatch(listing);
  }

  return null;
}

async function findListingById(db: EbaySalesSyncDb, id: string): Promise<any | null> {
  return db.listing.findUnique({
    where: { id },
    include: { item: { include: { card: true } } },
  });
}

async function findItemById(db: EbaySalesSyncDb, id: string): Promise<any | null> {
  return db.inventoryItem.findUnique({
    where: { id },
    include: {
      card: true,
      listings: {
        where: { channel: "EBAY", state: { in: ["ACTIVE", "DRAFT"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}

function listingToMatch(listing: any): ListingMatch | null {
  if (!listing?.item) return null;
  return {
    listingId: listing.id,
    itemId: listing.itemId,
    item: listing.item,
  };
}

function itemToMatch(item: any): ListingMatch | null {
  if (!item) return null;
  return {
    listingId: item.listings?.[0]?.id ?? null,
    itemId: item.id,
    item,
  };
}

function parsePokeDealSku(sku: string | null): string | null {
  const trimmed = sku?.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().startsWith("pdos-") ? trimmed.slice(5) : trimmed;
}

async function upsertImport(
  db: EbaySalesSyncDb,
  line: NormalizedEbayOrderLine,
  patch: {
    status: EbayOrderImportStatus;
    reason: string;
    itemId?: string | null;
    listingId?: string | null;
    saleId?: string | null;
    feesEstimatePence?: number | null;
  },
) {
  const data = {
    orderId: line.orderId,
    lineItemId: line.lineItemId,
    sku: line.sku,
    ebayItemId: line.ebayItemId,
    title: line.title,
    status: patch.status,
    reason: patch.reason,
    itemId: patch.itemId ?? null,
    listingId: patch.listingId ?? null,
    saleId: patch.saleId ?? null,
    orderCreatedAt: line.orderCreatedAt,
    paidAt: line.paidAt,
    buyerPaidPence: line.buyerPaidPence,
    postageChargedPence: line.postageChargedPence,
    feesEstimatePence: patch.feesEstimatePence ?? null,
    payload: line.raw as any,
  };
  return db.ebayOrderImport.upsert({
    where: { importKey: line.importKey },
    create: { importKey: line.importKey, ...data },
    update: data,
  });
}

function summarizeImport(row: any, overrideStatus?: EbayOrderImportStatus, overrideReason?: string): EbayOrderImportSummary {
  return {
    importKey: row.importKey,
    orderId: row.orderId,
    lineItemId: row.lineItemId ?? null,
    sku: row.sku ?? null,
    ebayItemId: row.ebayItemId ?? null,
    title: row.title ?? null,
    status: overrideStatus ?? row.status,
    reason: overrideReason ?? row.reason ?? null,
    itemId: row.itemId ?? null,
    listingId: row.listingId ?? null,
    saleId: row.saleId ?? null,
    buyerPaidPence: row.buyerPaidPence ?? null,
    postageChargedPence: row.postageChargedPence ?? null,
    feesEstimatePence: row.feesEstimatePence ?? null,
  };
}

function emptySyncResult(now: Date, reason: string): EbaySalesSyncResult {
  return {
    ok: true,
    checkedAt: now.toISOString(),
    skipped: true,
    reason,
    fetchedOrders: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    skippedCount: 0,
    imports: [],
  };
}

function isPaidOrder(order: EbayFulfillmentOrder): boolean {
  if (isPaidStatus(order.orderPaymentStatus)) return true;
  return Boolean(order.paymentSummary?.payments?.some((payment) => isPaidStatus(payment.paymentStatus)));
}

function isPaidStatus(status: string | undefined): boolean {
  return /^(paid|settled)$/i.test(status?.trim() ?? "");
}

function lineDeliveryPence(line: EbayFulfillmentLineItem): number {
  const delivery = line.deliveryCost;
  if (!delivery) return 0;
  if (isNestedDeliveryCost(delivery)) {
    return moneyToGbpPence(delivery.shippingCost) + moneyToGbpPence(delivery.importCharges);
  }
  return moneyToGbpPence(delivery);
}

function isNestedDeliveryCost(
  delivery: EbayFulfillmentLineItem["deliveryCost"],
): delivery is { shippingCost?: EbayMoney; importCharges?: EbayMoney } {
  return typeof delivery === "object" && delivery !== null && ("shippingCost" in delivery || "importCharges" in delivery);
}

function moneyToGbpPence(money: EbayMoney | undefined): number {
  if (!money?.value) return 0;
  const currency = money.currency?.toUpperCase() ?? "GBP";
  if (currency !== "GBP") return 0;
  const parsed = Number(money.value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatGbp(pence: number): string {
  return `£${(Math.max(0, Math.round(pence)) / 100).toFixed(2)}`;
}
