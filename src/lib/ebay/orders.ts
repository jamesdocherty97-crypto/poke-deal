import { createInboxAlert } from "../alerts/inbox.js";
import { estimateSaleCosts } from "../dealer/saleFees.js";
import { allocatePence, planUnitSale, splitPence } from "../dealer/unitSale.js";
import { planSaleListingUpdates } from "../dealer/saleListingUpdates.js";
import { lockInventoryItemForSale, type SaleLockDb } from "../inventory/saleTransaction.js";
import { formatGbp } from "../format/money.js";
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
  /** Present only when a promotion reduced the line's cost; lineItemCost is the pre-discount amount. */
  discountedLineItemCost?: EbayMoney;
  total?: EbayMoney;
  deliveryCost?: EbayLineDeliveryCost | EbayMoney;
  /** Present only when the buyer is due a refund for this line; amounts are the seller's net. */
  refunds?: Array<{ amount?: EbayMoney; refundDate?: string }>;
};

/** Delivery for all units of a line. shippingCost is always returned (0.0 when free). */
export type EbayLineDeliveryCost = {
  shippingCost?: EbayMoney;
  handlingCost?: EbayMoney;
  importCharges?: EbayMoney;
  /** A shipping discount on this line, present only when one applies. */
  discountAmount?: EbayMoney;
};

export type EbayFulfillmentOrder = {
  orderId?: string;
  creationDate?: string;
  lastModifiedDate?: string;
  orderPaymentStatus?: string;
  orderFulfillmentStatus?: string;
  cancelStatus?: {
    /** IN_PROGRESS while any cancellation request exists, including rejected ones. */
    cancelState?: string;
    cancelRequests?: Array<{ cancelRequestState?: string }>;
  };
  pricingSummary?: {
    /** All line items before discounts. */
    priceSubtotal?: EbayMoney;
    /** Item-level discounts for the whole order, usually negative; excludes delivery discounts. */
    priceDiscount?: EbayMoney;
    /** Delivery for every line before delivery discounts (Sell Fulfillment). */
    deliveryCost?: EbayMoney;
    /** Delivery discounts for the order, usually negative. */
    deliveryDiscount?: EbayMoney;
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

const MAX_FULFILLMENT_ORDER_PAGES = 20;

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
  /** Set when the line must stay in the manual queue instead of booking a sale. */
  holdReason?: string | null;
  /** False when eBay reported amounts in another currency; the pence fields are then not usable. */
  amountsInGbp?: boolean;
  /** Added to a manual-queue reason when eBay shows a refund on this line. */
  refundNote?: string | null;
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
  /** Imported sales newly found cancelled or refunded in full on eBay during this sync. */
  reversedCount: number;
  /** Imported sales newly found partly refunded on eBay during this sync. */
  partialRefundCount: number;
  /** False when the extra read for refunds and cancellations on older orders failed; imports are unaffected. */
  lateChangesChecked: boolean;
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

type EbaySalesSyncDb = SaleLockDb & {
  $transaction<T>(fn: (tx: EbaySalesSyncDb) => Promise<T>): Promise<T>;
  ebayOrderImport: {
    findUnique(args: any): Promise<any | null>;
    findMany(args: any): Promise<any[]>;
    count(args?: any): Promise<number>;
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
  const windowStart = since ?? new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  let orders: EbayFulfillmentOrder[];
  let changedOrders: EbayFulfillmentOrder[] = [];
  let lateChangesChecked = false;
  try {
    const { accessToken } = await getAccessTokenWithSource(config, fetchImpl, { refreshToken });
    const window = { config, accessToken, since: windowStart, until: now, limit: safeLimit, fetchImpl };
    // Imports read orders created in the window, exactly as before.
    orders = await fetchFulfillmentOrdersPages({ ...window, dateField: "creationdate" });
    // A second, best-effort read finds refunds and cancellations on older
    // orders. It only raises signals, so its failure never blocks imports.
    try {
      changedOrders = await fetchFulfillmentOrdersPages({ ...window, dateField: "lastmodifieddate" });
      lateChangesChecked = true;
    } catch {
      changedOrders = [];
    }
  } catch (err) {
    throw new Error(ebayErrorMessage(err, "eBay sales sync failed"));
  }
  const lines = orders.flatMap(normalizePaidEbayOrder);
  const imports: EbayOrderImportSummary[] = [];

  for (const line of lines) {
    imports.push(await importEbayOrderLine(db, line));
  }

  // The latest view of each order, preferring the last-modified read.
  const latestOrders = new Map<string, EbayFulfillmentOrder>();
  for (const order of [...orders, ...changedOrders]) {
    const orderId = order.orderId?.trim();
    if (orderId) latestOrders.set(orderId, order);
  }
  let reversedCount = 0;
  let partialRefundCount = 0;
  for (const signal of [...latestOrders.values()].flatMap(ebayOrderLineSignals)) {
    if ((await flagOrderLineSignal(db, signal)) !== "new") continue;
    if (signal.kind === "reversed") reversedCount += 1;
    else partialRefundCount += 1;
  }

  return {
    ok: true,
    checkedAt: now.toISOString(),
    skipped: false,
    fetchedOrders: orders.length,
    matchedCount: imports.filter((row) => row.status === "MATCHED").length,
    unmatchedCount: imports.filter((row) => row.status === "UNMATCHED").length,
    skippedCount: imports.filter((row) => row.status === "SKIPPED").length,
    reversedCount,
    partialRefundCount,
    lateChangesChecked,
    imports,
  };
}

export function buildFulfillmentOrdersPath({
  since,
  until,
  limit = 25,
  offset = 0,
  dateField = "creationdate",
}: {
  since: Date;
  until: Date;
  limit?: number;
  offset?: number;
  /** eBay applies one date filter; with both, it ignores lastmodifieddate. */
  dateField?: "creationdate" | "lastmodifieddate";
}): string {
  const filter = `${dateField}:[${since.toISOString()}..${until.toISOString()}]`;
  const params = new URLSearchParams({
    filter,
    limit: String(Math.max(1, Math.min(100, Math.floor(limit)))),
    offset: String(Math.max(0, Math.floor(offset))),
  });
  return `/sell/fulfillment/v1/order?${params.toString()}`;
}

async function fetchFulfillmentOrdersPages({
  config,
  accessToken,
  since,
  until,
  limit,
  fetchImpl,
  dateField,
}: {
  config: EbayConfig;
  accessToken: string;
  since: Date;
  until: Date;
  limit: number;
  fetchImpl: typeof fetch;
  dateField: "creationdate" | "lastmodifieddate";
}): Promise<EbayFulfillmentOrder[]> {
  const orders: EbayFulfillmentOrder[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_FULFILLMENT_ORDER_PAGES; page += 1) {
    const path = buildFulfillmentOrdersPath({ since, until, limit, offset, dateField });
    const response = await ebayJson<EbayFulfillmentOrdersResponse>(
      config,
      path,
      accessToken,
      { marketplaceId: config.marketplaceId },
      fetchImpl,
    );
    const pageOrders = response.orders ?? [];
    orders.push(...pageOrders);

    const total = readNonNegativeInt(response.total);
    const responseOffset = readNonNegativeInt(response.offset) ?? offset;
    const responseLimit = readPositiveInt(response.limit) ?? limit;
    const nextOffset = responseOffset + pageOrders.length;
    if (pageOrders.length === 0 || (total != null && nextOffset >= total) || pageOrders.length < responseLimit) {
      return orders;
    }
    offset = nextOffset;
  }

  throw new Error(`eBay Fulfillment pagination exceeded ${MAX_FULFILLMENT_ORDER_PAGES} pages; no partial import was applied`);
}

export function normalizePaidEbayOrder(order: EbayFulfillmentOrder): NormalizedEbayOrderLine[] {
  const orderId = order.orderId?.trim();
  // Cancelled and refunded orders stay in getOrders results. A cancellation
  // still in progress is held like an unpaid order until eBay settles it.
  if (!orderId || !isPaidOrder(order) || isReversedOrder(order) || hasPendingCancellation(order)) return [];

  const lines = order.lineItems ?? [];
  const amounts = ebayOrderLineAmounts(order);
  const partlyRefunded = new Set(ebayOrderLineSignals(order).filter((signal) => signal.kind === "partial-refund").map((signal) => signal.importKey));
  const orderCreatedAt = parseDate(order.creationDate);
  const paidAt = parseDate(order.paymentSummary?.payments?.find((payment) => isPaidStatus(payment.paymentStatus))?.paymentDate) ?? orderCreatedAt;

  return lines.flatMap((line, index) => {
    const lineAmounts = amounts[index]!;
    // A line refunded in full is a reversal: there is no sale to book.
    if (lineRefundedInFull(lineAmounts)) return [];
    const lineItemId = line.lineItemId?.trim() || null;
    const importKey = lineImportKey(orderId, line, index);
    const holdReason = lineAmounts.inGbp
      ? null
      : "eBay reported this order line in a currency other than GBP. Record the sale manually in GBP.";

    return [{
      importKey,
      orderId,
      lineItemId,
      sku: line.sku?.trim() || null,
      ebayItemId: line.legacyItemId?.trim() || null,
      title: line.title?.trim() || null,
      quantity: Math.max(1, Math.floor(line.quantity ?? 1)),
      orderCreatedAt,
      paidAt,
      itemSubtotalPence: lineAmounts.itemSubtotalPence,
      postageChargedPence: lineAmounts.postageChargedPence,
      buyerPaidPence: lineAmounts.buyerPaidPence,
      holdReason,
      amountsInGbp: lineAmounts.inGbp,
      refundNote: partlyRefunded.has(importKey) ? PARTIAL_REFUND_QUEUE_NOTE : null,
      // Persist only fulfillment fields used for audit/replay. The provider's
      // full order object may contain buyer account or address data and must
      // not be retained in this operational ledger.
      raw: {
        schemaVersion: 1,
        order: {
          orderId: order.orderId,
          creationDate: order.creationDate,
          lastModifiedDate: order.lastModifiedDate,
          orderPaymentStatus: order.orderPaymentStatus,
          orderFulfillmentStatus: order.orderFulfillmentStatus,
        },
        line: {
          lineItemId: line.lineItemId,
          legacyItemId: line.legacyItemId,
          sku: line.sku,
          title: line.title,
          quantity: line.quantity,
        },
        // Held lines keep eBay's own amounts so the sale can be recorded by hand.
        ...(lineAmounts.inGbp ? {} : { heldAmounts: heldAmountsForLine(order, line) }),
      },
    }];
  });
}

export type EbayOrderLineAmounts = {
  itemSubtotalPence: number;
  postageChargedPence: number;
  buyerPaidPence: number;
  refundedPence: number;
  /** eBay's own total for the line, when reported. */
  lineTotalPence: number | null;
  inGbp: boolean;
};

/**
 * Per-line GBP amounts reconciled to the order's own totals. Line postage and
 * discounts are only weights: the order's delivery total and item discount are
 * spread across lines by largest remainder, so the lines always add up to what
 * eBay charged the buyer.
 */
export function ebayOrderLineAmounts(order: EbayFulfillmentOrder): EbayOrderLineAmounts[] {
  const lines = order.lineItems ?? [];
  if (lines.length === 0) return [];
  const pricing = order.pricingSummary;
  const orderInGbp = ![pricing?.priceSubtotal, pricing?.priceDiscount, pricing?.deliveryCost, pricing?.deliveryDiscount].some(hasNonGbpAmount);

  // Item cost by presence, so a 100% discount stays 0 rather than falling
  // through to the line total, which already includes postage.
  const listed = lines.map((line) => gbpPence(line.lineItemCost));
  let items = lines.map((line, index) => {
    const explicit = gbpPence(line.discountedLineItemCost) ?? listed[index];
    if (explicit != null) return explicit;
    return Math.max(0, (gbpPence(line.total) ?? 0) - (lineDeliveryPence(line) ?? 0));
  });
  const orderDiscount = gbpPence(pricing?.priceDiscount, { absolute: true });
  if (orderDiscount) {
    const preDiscount = lines.map((_, index) => listed[index] ?? items[index] ?? 0);
    const subtotal = gbpPence(pricing?.priceSubtotal) ?? sumPence(preDiscount);
    const target = Math.max(0, subtotal - orderDiscount);
    if (sumPence(items) !== target) items = allocatePence(target, preDiscount);
  }

  const reported = lines.map((line) => lineDeliveryPence(line) ?? 0);
  // Sell Fulfillment reports order delivery before delivery discounts.
  const deliveryBeforeDiscount = gbpPence(pricing?.deliveryCost);
  const orderDelivery = deliveryBeforeDiscount == null
    ? null
    : Math.max(0, deliveryBeforeDiscount - (gbpPence(pricing?.deliveryDiscount, { absolute: true }) ?? 0));
  const postage = orderDelivery == null || sumPence(reported) === orderDelivery
    ? reported
    : allocatePence(orderDelivery, reported);

  return lines.map((line, index) => {
    const itemSubtotalPence = items[index] ?? 0;
    const postageChargedPence = postage[index] ?? 0;
    return {
      itemSubtotalPence,
      postageChargedPence,
      buyerPaidPence: itemSubtotalPence + postageChargedPence,
      refundedPence: sumPence((line.refunds ?? []).map((refund) => gbpPence(refund.amount) ?? 0)),
      lineTotalPence: gbpPence(line.total),
      inGbp: orderInGbp && !hasNonGbpLineAmount(line),
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
    if (line.holdReason) {
      return summarizeImport(await upsertImport(tx, line, { status: "UNMATCHED", reason: line.holdReason }));
    }

    const match = await findListingMatch(tx, line);
    if (!match) {
      const row = await upsertImport(tx, line, {
        status: "UNMATCHED",
        reason: line.sku ? "No Poke Deal stock row matched this eBay SKU." : "eBay order line had no SKU to match.",
      });
      return summarizeImport(row);
    }

    await lockInventoryItemForSale(tx, match.itemId);
    // Another sync may have imported this line while this transaction waited
    // for the stock row. Never overwrite its receipt with an unmatched result.
    const committedImport = await tx.ebayOrderImport.findUnique({ where: { importKey: line.importKey } });
    if (committedImport?.saleId || committedImport?.status === "MATCHED") {
      return summarizeImport(committedImport, "SKIPPED", "Already imported.");
    }
    const item = await tx.inventoryItem.findUnique({
      where: { id: match.itemId },
      include: { card: true, listings: true },
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
    const itemRevenues = splitPence(line.itemSubtotalPence, salePlan.soldQuantity);
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
            costBasis: item.costBasis,
            itemRevenue: itemRevenues[index] ?? 0,
            costsEstimated: true,
            clientMutationId: `ebay-order:${line.importKey}`,
            mutationIndex: index,
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

    const listingUpdates = planSaleListingUpdates({
      listings: item.listings ?? [],
      soldListingId: match.listingId,
      soldChannel: "EBAY",
      fullySold: salePlan.fullySold,
    });
    if (listingUpdates.soldListingIds.length > 0) {
      await tx.listing.updateMany({
        where: { itemId: item.id, id: { in: listingUpdates.soldListingIds }, state: { in: ["DRAFT", "ACTIVE"] } },
        data: { state: "SOLD", endedAt: soldAt },
      });
    }
    if (listingUpdates.endedListingIds.length > 0) {
      await tx.listing.updateMany({
        where: { itemId: item.id, id: { in: listingUpdates.endedListingIds }, state: { in: ["DRAFT", "ACTIVE"] } },
        data: { state: "ENDED", endedAt: soldAt },
      });
    }
    if (listingUpdates.externalAttentionIds.length > 0) {
      await createInboxAlert(tx as any, {
        kind: "REPRICE",
        title: salePlan.fullySold ? `Remove sold stock from other listings: ${item.card.name}` : `Update other listing quantities: ${item.card.name}`,
        message: salePlan.fullySold
          ? `${listingUpdates.externalAttentionIds.length} other marketplace listing(s) may still be live. Remove them and confirm removal in Listings.`
          : `${salePlan.remainingQuantity} copies remain. Check quantities on the other ${listingUpdates.externalAttentionIds.length} marketplace listing(s).`,
        href: "/?view=listings",
        sourceKey: `sale-listings:${line.importKey}`,
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
      message: `${item.card.setName}${item.card.number ? ` #${item.card.number}` : ""} sold for ${formatGbp(line.buyerPaidPence)}. Fees and seller postage are estimated. Confirm actual costs in Profit after checking the marketplace record.`,
      pence: line.buyerPaidPence,
      href: "/?view=listings",
      sourceKey: `ebay-sale:${line.importKey}`,
    });

    return summarizeImport(saved);
  });
}


export async function countEbayOrderImports(
  db: Pick<EbaySalesSyncDb, "ebayOrderImport">,
  status?: EbayOrderImportStatus,
): Promise<number> {
  return db.ebayOrderImport.count({
    where: status ? { status } : undefined,
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
  const reason = patch.status === "UNMATCHED" && line.refundNote ? `${patch.reason} ${line.refundNote}` : patch.reason;
  const data = {
    orderId: line.orderId,
    lineItemId: line.lineItemId,
    sku: line.sku,
    ebayItemId: line.ebayItemId,
    title: line.title,
    status: patch.status,
    reason,
    itemId: patch.itemId ?? null,
    listingId: patch.listingId ?? null,
    saleId: patch.saleId ?? null,
    orderCreatedAt: line.orderCreatedAt,
    paidAt: line.paidAt,
    buyerPaidPence: line.amountsInGbp === false ? null : line.buyerPaidPence,
    postageChargedPence: line.amountsInGbp === false ? null : line.postageChargedPence,
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
    reversedCount: 0,
    partialRefundCount: 0,
    lateChangesChecked: false,
    imports: [],
  };
}

export type EbayOrderLineSignal = {
  importKey: string;
  orderId: string;
  title: string | null;
  kind: "reversed" | "partial-refund";
};

const REVERSED_BOOKED_REASON = "Cancelled or refunded in full on eBay after import. The booked sale still counts in Profit.";
const REVERSED_QUEUE_REASON = "Cancelled or refunded in full on eBay. There is no sale to record.";
const PARTIAL_REFUND_BOOKED_REASON = "eBay shows a refund on this order. Profit shows the amount originally paid.";
const PARTIAL_REFUND_QUEUE_NOTE = "eBay shows a refund on this order. Check the refunded amount before recording the sale.";

/**
 * Lines eBay now reports as cancelled or refunded. A whole-order cancellation
 * or full refund, or a line refunded in full, is a reversal. A partial refund
 * applies to the refunded lines, or to every line when eBay refunded at order
 * level only.
 */
export function ebayOrderLineSignals(order: EbayFulfillmentOrder): EbayOrderLineSignal[] {
  const orderId = order.orderId?.trim();
  const lines = order.lineItems ?? [];
  if (!orderId || lines.length === 0) return [];
  const amounts = ebayOrderLineAmounts(order);
  const orderReversed = isReversedOrder(order);
  const lineRefundsReported = amounts.some((line) => line.refundedPence > 0);
  const orderPartlyRefunded = /^partially_refunded$/i.test(order.orderPaymentStatus?.trim() ?? "");
  return lines.flatMap((line, index): EbayOrderLineSignal[] => {
    const lineAmounts = amounts[index]!;
    const kind = orderReversed || lineRefundedInFull(lineAmounts)
      ? "reversed"
      : lineAmounts.refundedPence > 0 || (orderPartlyRefunded && !lineRefundsReported)
        ? "partial-refund"
        : null;
    return kind ? [{ importKey: lineImportKey(orderId, line, index), orderId, title: line.title?.trim() || null, kind }] : [];
  });
}

/**
 * Records a cancellation or refund against an earlier import. Alerts once per
 * line and returns "new" only the first time, so repeat syncs do not recount.
 */
async function flagOrderLineSignal(db: EbaySalesSyncDb, signal: EbayOrderLineSignal): Promise<"new" | "seen" | "none"> {
  const where = { importKey: signal.importKey };
  const existing = await db.ebayOrderImport.findUnique({ where });
  if (!existing) return "none";
  const booked = Boolean(existing.saleId) || existing.status === "MATCHED";
  const title = signal.title ?? existing.title ?? signal.orderId;

  if (!booked) {
    // Keep the manual queue from inviting a sale that eBay has reversed or reduced.
    if (existing.status !== "UNMATCHED") return "none";
    if (signal.kind === "reversed") {
      await db.ebayOrderImport.update({ where, data: { status: "SKIPPED", reason: REVERSED_QUEUE_REASON } });
    } else if (!String(existing.reason ?? "").includes(PARTIAL_REFUND_QUEUE_NOTE)) {
      await db.ebayOrderImport.update({ where, data: { reason: `${existing.reason ?? ""} ${PARTIAL_REFUND_QUEUE_NOTE}`.trim() } });
    }
    return "none";
  }

  if (signal.kind === "reversed") {
    if (existing.reason === REVERSED_BOOKED_REASON) return "seen";
    await db.ebayOrderImport.update({ where, data: { reason: REVERSED_BOOKED_REASON } });
    await createInboxAlert(db as any, {
      kind: "EBAY_SALE",
      title: `eBay order cancelled or refunded: ${title}`,
      message: `eBay now shows order ${signal.orderId} as cancelled or refunded in full for this card. Poke Deal booked it as a sale when it was paid, so that sale still counts in Profit and the stock was reduced when it was booked. Imported sales cannot be undone here; check the order on eBay before selling this copy again.`,
      href: "/?view=pnl",
      sourceKey: `ebay-reversal:${signal.importKey}`,
    });
    return "new";
  }

  if (existing.reason === PARTIAL_REFUND_BOOKED_REASON || existing.reason === REVERSED_BOOKED_REASON) return "seen";
  await db.ebayOrderImport.update({ where, data: { reason: PARTIAL_REFUND_BOOKED_REASON } });
  await createInboxAlert(db as any, {
    kind: "EBAY_SALE",
    title: `eBay refund on a booked sale: ${title}`,
    message: `eBay shows a refund on order ${signal.orderId}, which Poke Deal booked as a sale. Profit still shows the amount originally paid. Check the refund on eBay.`,
    href: "/?view=pnl",
    sourceKey: `ebay-partial-refund:${signal.importKey}`,
  });
  return "new";
}

/** Judged against eBay's own line total, not this app's postage allocation. */
function lineRefundedInFull(line: EbayOrderLineAmounts): boolean {
  const lineTotal = line.lineTotalPence ?? line.buyerPaidPence;
  return lineTotal > 0 && line.refundedPence >= lineTotal;
}

function heldAmountsForLine(order: EbayFulfillmentOrder, line: EbayFulfillmentLineItem) {
  const delivery = line.deliveryCost;
  return {
    lineItemCost: pickMoney(line.lineItemCost),
    discountedLineItemCost: pickMoney(line.discountedLineItemCost),
    total: pickMoney(line.total),
    deliveryCost: !delivery ? undefined : isNestedDeliveryCost(delivery)
      ? {
        shippingCost: pickMoney(delivery.shippingCost),
        handlingCost: pickMoney(delivery.handlingCost),
        importCharges: pickMoney(delivery.importCharges),
        discountAmount: pickMoney(delivery.discountAmount),
      }
      : pickMoney(delivery),
    orderDeliveryCost: pickMoney(order.pricingSummary?.deliveryCost),
    orderDeliveryDiscount: pickMoney(order.pricingSummary?.deliveryDiscount),
  };
}

function pickMoney(money: EbayMoney | undefined): EbayMoney | undefined {
  return money ? { value: money.value, currency: money.currency } : undefined;
}

// Existing import receipts are keyed by this exact format; changing it would re-import paid orders.
function lineImportKey(orderId: string, line: EbayFulfillmentLineItem, index: number): string {
  return `ebay:${orderId}:${(line.lineItemId?.trim() || null) ?? line.legacyItemId ?? index}`;
}

function isReversedOrder(order: EbayFulfillmentOrder): boolean {
  return /^fully_refunded$/i.test(order.orderPaymentStatus?.trim() ?? "") ||
    /^cancell?ed$/i.test(order.cancelStatus?.cancelState?.trim() ?? "");
}

/**
 * Held only while a cancellation request is still open. cancelState stays
 * IN_PROGRESS after a request is rejected, and those orders must import.
 */
function hasPendingCancellation(order: EbayFulfillmentOrder): boolean {
  return (order.cancelStatus?.cancelRequests ?? []).some((request) => /^requested$/i.test(request.cancelRequestState?.trim() ?? ""));
}

function hasNonGbpLineAmount(line: EbayFulfillmentLineItem): boolean {
  const delivery = line.deliveryCost;
  const deliveryAmounts = !delivery
    ? []
    : isNestedDeliveryCost(delivery)
      ? [delivery.shippingCost, delivery.handlingCost, delivery.importCharges, delivery.discountAmount]
      : [delivery];
  const refundAmounts = (line.refunds ?? []).map((refund) => refund.amount);
  return [line.lineItemCost, line.discountedLineItemCost, line.total, ...deliveryAmounts, ...refundAmounts].some(hasNonGbpAmount);
}

function hasNonGbpAmount(money: EbayMoney | undefined): boolean {
  return Boolean(money?.value && money.currency && money.currency.toUpperCase() !== "GBP");
}

function isPaidOrder(order: EbayFulfillmentOrder): boolean {
  if (isPaidStatus(order.orderPaymentStatus)) return true;
  return Boolean(order.paymentSummary?.payments?.some((payment) => isPaidStatus(payment.paymentStatus)));
}

function isPaidStatus(status: string | undefined): boolean {
  return /^(paid|settled)$/i.test(status?.trim() ?? "");
}

/** The line's own delivery charge after its shipping discount, or null when the line reports none. */
function lineDeliveryPence(line: EbayFulfillmentLineItem): number | null {
  const delivery = line.deliveryCost;
  if (!delivery) return null;
  if (isNestedDeliveryCost(delivery)) {
    const charges = [delivery.shippingCost, delivery.handlingCost, delivery.importCharges].map((money) => gbpPence(money));
    if (charges.every((charge) => charge == null)) return null;
    const discount = gbpPence(delivery.discountAmount, { absolute: true }) ?? 0;
    return Math.max(0, sumPence(charges.map((charge) => charge ?? 0)) - discount);
  }
  return gbpPence(delivery);
}

function isNestedDeliveryCost(delivery: EbayFulfillmentLineItem["deliveryCost"]): delivery is EbayLineDeliveryCost {
  return typeof delivery === "object" && delivery !== null &&
    ("shippingCost" in delivery || "handlingCost" in delivery || "importCharges" in delivery || "discountAmount" in delivery);
}

/**
 * GBP pence for an amount eBay reported, or null when it is absent, blank,
 * unparseable or in another currency (callers hold those lines instead).
 */
function gbpPence(money: EbayMoney | undefined, { absolute = false }: { absolute?: boolean } = {}): number | null {
  const text = money?.value?.trim();
  if (!text) return null;
  if ((money?.currency?.toUpperCase() ?? "GBP") !== "GBP") return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  const pence = Math.round(Math.abs(parsed) * 100);
  return absolute || parsed >= 0 ? pence : 0;
}

function sumPence(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readNonNegativeInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
