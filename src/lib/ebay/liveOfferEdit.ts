import type { EbayConfig } from "./config.js";
import { ebayFetch, ebayJson } from "./client.js";
import { readEbayApiError } from "./errors.js";
import { validateEbayListPricePence } from "./offerSync.js";

export type LiveEbayEditField = "title" | "description" | "price";
type JsonRecord = Record<string, unknown>;

export class LiveEbayEditError extends Error {
  constructor(
    message: string,
    readonly status: 409 | 502,
    readonly confirmedFields: LiveEbayEditField[] = [],
    readonly attemptedFields: LiveEbayEditField[] = [],
  ) { super(message); }
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function without(source: JsonRecord, keys: string[]): JsonRecord {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
}

export interface LiveEbayOfferIdentity {
  config: EbayConfig;
  accessToken: string;
  offerId: string;
  listingId: string;
  sku: string;
}

export interface LiveEbayOfferSnapshot {
  title: string;
  description: string;
  listPricePence: number;
}

/** Read the actual buyer-facing copy instead of assuming saved app text is current. */
export async function readLiveEbayOfferSnapshot(
  input: LiveEbayOfferIdentity,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveEbayOfferSnapshot> {
  return (await readLiveEbayOffer(input, fetchImpl)).snapshot;
}

async function readLiveEbayOffer(input: LiveEbayOfferIdentity, fetchImpl: typeof fetch) {
  const { config, accessToken, offerId, listingId, sku } = input;
  const offerPath = `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`;
  const inventoryPath = `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;
  const offer = record(await ebayJson<unknown>(config, offerPath, accessToken, {}, fetchImpl));
  const listing = record(offer.listing);
  const remotePrice = record(record(offer.pricingSummary).price);
  const remoteValue = typeof remotePrice.value === "string" && /^\d+(?:\.\d{1,2})?$/.test(remotePrice.value) ? remotePrice.value : null;
  const [pounds, pence = ""] = remoteValue?.split(".") ?? [];
  const remotePricePence = remoteValue === null ? NaN : Number(pounds) * 100 + Number(pence.padEnd(2, "0"));
  if (offer.sku !== sku || listing.listingId !== listingId ||
      (offer.offerId !== undefined && offer.offerId !== offerId)) {
    throw new LiveEbayEditError("The linked eBay offer does not match this live listing. No update was sent; check the listing on eBay.", 409);
  }
  if (offer.status !== "PUBLISHED" || listing.listingStatus !== "ACTIVE" || offer.format !== "FIXED_PRICE") {
    throw new LiveEbayEditError("This eBay offer is no longer an active fixed-price listing. No update was sent; refresh its status on eBay.", 409);
  }
  if (offer.marketplaceId !== config.marketplaceId || offer.marketplaceId !== "EBAY_GB" ||
      remotePrice.currency !== "GBP" || !Number.isSafeInteger(remotePricePence) || remotePricePence < 99 || remotePricePence > 2_147_483_647) {
    throw new LiveEbayEditError("The live eBay marketplace or GBP price could not be verified. No update was sent; check the listing on eBay.", 409);
  }
  const inventory = record(await ebayJson<unknown>(config, inventoryPath, accessToken, {}, fetchImpl));
  const product = record(inventory.product);
  if (inventory.sku !== sku || typeof product.title !== "string" || !product.title.trim() ||
      (Array.isArray(inventory.inventoryItemGroupKeys) && inventory.inventoryItemGroupKeys.length) ||
      (Array.isArray(inventory.groupIds) && inventory.groupIds.length)) {
    throw new LiveEbayEditError("This inventory record cannot be safely edited as a single card. No update was sent; edit the listing on eBay.", 409);
  }
  const description = offer.listingDescription ?? product.description;
  if (typeof description !== "string") {
    throw new LiveEbayEditError("The live eBay description could not be read. No update was sent; check the listing on eBay.", 409);
  }
  return { offer, inventory, offerPath, inventoryPath, remotePrice,
    snapshot: { title: product.title, description, listPricePence: remotePricePence } };
}

/**
 * Inventory API PUTs replace resources. Start from eBay's current records and
 * change only the reviewed fields; never rebuild a live listing from stock.
 * https://developer.ebay.com/develop/guides/sell/listing-management
 *
 * The inventory title and offer copy/price are separate remote writes. A failure
 * can leave one accepted, so report that honestly and never attempt a rollback
 * that could overwrite an intervening seller edit or sale.
 */
export async function editLiveEbayOffer(input: LiveEbayOfferIdentity & {
  changes: { title?: string; description?: string; listPricePence?: number };
}, fetchImpl: typeof fetch = fetch): Promise<{ fields: LiveEbayEditField[]; snapshot: LiveEbayOfferSnapshot }> {
  const { config, accessToken, changes, sku, offerId } = input;
  const { offer, inventory, offerPath, inventoryPath, remotePrice, snapshot } = await readLiveEbayOffer(input, fetchImpl);
  if (changes.listPricePence !== undefined) {
    const error = validateEbayListPricePence(changes.listPricePence);
    if (error) throw new LiveEbayEditError(error, 409);
  }

  const confirmedFields: LiveEbayEditField[] = [];
  let attemptedFields: LiveEbayEditField[] = [];
  const put = async (path: string, payload: JsonRecord) => {
    const response = await ebayFetch(config, path, accessToken, { method: "PUT", body: JSON.stringify(payload) }, fetchImpl);
    if (!response.ok) throw await readEbayApiError(response, path);
    if (response.status !== 204) {
      const raw = await response.text();
      if (raw.trim()) {
        const result = record(JSON.parse(raw));
        if (Array.isArray(result.errors) && result.errors.length) {
          const detail = record(result.errors[0]);
          throw new Error(typeof detail.message === "string" ? detail.message : "eBay returned an error with the update response.");
        }
      }
    }
  };
  try {
    if (changes.title !== undefined) {
      attemptedFields = ["title"];
      // sku/locale/group associations and allocationByFormat are read-only.
      const payload = without(inventory, ["sku", "locale", "groupIds", "inventoryItemGroupKeys"]);
      const availability = record(payload.availability);
      if (availability.shipToLocationAvailability) {
        payload.availability = { ...availability, shipToLocationAvailability: without(record(availability.shipToLocationAvailability), ["allocationByFormat"]) };
      }
      payload.product = { ...record(inventory.product), title: changes.title };
      await put(inventoryPath, payload);
      confirmedFields.push("title");
    }
    const offerFields: LiveEbayEditField[] = [];
    const payload = without(offer, ["offerId", "status", "listing", "sku", "marketplaceId", "format"]);
    if (changes.description !== undefined) {
      payload.listingDescription = changes.description;
      offerFields.push("description");
    }
    if (changes.listPricePence !== undefined) {
      payload.pricingSummary = { ...record(offer.pricingSummary), price: { ...remotePrice, value: (changes.listPricePence / 100).toFixed(2), currency: "GBP" } };
      offerFields.push("price");
    }
    if (changes.listPricePence !== undefined && changes.description === undefined) {
      // This endpoint changes only price: never resend quantity from a read
      // made before a concurrent sale. A 200/207 envelope is not per-offer
      // confirmation; inspect the matching result's statusCode as documented.
      // https://developer.ebay.com/api-docs/sell/static/inventory/bulk-updates.html
      attemptedFields = ["price"];
      const result = await ebayJson<{ responses?: JsonRecord[] }>(config,
        "/sell/inventory/v1/bulk_update_price_quantity", accessToken, {
          method: "POST",
          body: JSON.stringify({ requests: [{ sku, offers: [{ offerId, price: { value: (changes.listPricePence / 100).toFixed(2), currency: "GBP" } }] }] }),
        }, fetchImpl);
      const rows = Array.isArray(result.responses) ? result.responses : [];
      const response = rows.find((row) => row.offerId === offerId && (row.sku === undefined || row.sku === sku));
      if (!response || response.statusCode !== 200 ||
          (Array.isArray(response.errors) && response.errors.length)) {
        const detail = record(Array.isArray(response?.errors) ? response.errors[0] : null);
        throw new Error(typeof detail.message === "string" ? detail.message : "eBay did not confirm this offer's price update.");
      }
      confirmedFields.push("price");
    } else if (offerFields.length) {
      attemptedFields = offerFields;
      await put(offerPath, payload);
      confirmedFields.push(...offerFields);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "The request did not complete.";
    throw new LiveEbayEditError(
      `${confirmedFields.length ? `eBay accepted the ${confirmedFields.join(" and ")} update, but did not confirm the remaining changes.` : "eBay did not confirm the update."} Your saved app details were not changed. Check the live listing before retrying. ${detail}`,
      502, [...confirmedFields], [...attemptedFields],
    );
  }
  return { fields: confirmedFields, snapshot: {
    title: changes.title ?? snapshot.title,
    description: changes.description ?? snapshot.description,
    listPricePence: changes.listPricePence ?? snapshot.listPricePence,
  } };
}
