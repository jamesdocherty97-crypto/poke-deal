// eBay Offer API helpers.
// Creates, looks up by SKU, and publishes eBay offers for a FIXED_PRICE listing.

import type { EbayConfig } from "./config.js";
import { ebayFetch, ebayJson } from "./client.js";
import { readEbayApiError } from "./errors.js";
import type { ListingPack } from "../dealer/listingPack.js";
import type { EbayPolicies } from "./policies.js";
import { EBAY_UK_CATEGORY_POKEMON } from "./config.js";

export interface EbayOfferPayload {
  sku: string;
  marketplaceId: string;
  format: "FIXED_PRICE";
  availableQuantity: number;
  categoryId: string;
  listingDescription: string;
  listingPolicies: {
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
  };
  pricingSummary: {
    price: { value: string; currency: "GBP" };
  };
  merchantLocationKey?: string;
  includeCatalogProductDetails: boolean;
}

export interface EbayOfferResponse {
  offerId: string;
}

export interface EbayPublishResponse {
  listingId: string;
}

export function buildOfferPayload(
  sku: string,
  pack: ListingPack,
  policies: EbayPolicies,
  config: EbayConfig,
  quantity = 1,
  categoryId = EBAY_UK_CATEGORY_POKEMON,
): EbayOfferPayload {
  const priceGbp = (pack.suggestedPricePence / 100).toFixed(2);

  const payload: EbayOfferPayload = {
    sku,
    marketplaceId: config.marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: Math.max(1, quantity),
    categoryId,
    listingDescription: pack.description,
    listingPolicies: {
      fulfillmentPolicyId: policies.fulfillmentPolicyId,
      paymentPolicyId: policies.paymentPolicyId,
      returnPolicyId: policies.returnPolicyId,
    },
    pricingSummary: {
      price: { value: priceGbp, currency: "GBP" },
    },
    includeCatalogProductDetails: false,
  };

  if (policies.merchantLocationKey) {
    payload.merchantLocationKey = policies.merchantLocationKey;
  }

  return payload;
}

export async function createEbayOffer(
  config: EbayConfig,
  payload: EbayOfferPayload,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbayOfferResponse> {
  return ebayJson<EbayOfferResponse>(
    config,
    "/sell/inventory/v1/offer",
    accessToken,
    { method: "POST", body: JSON.stringify(payload) },
    fetchImpl,
  );
}

export async function updateEbayOffer(
  config: EbayConfig,
  offerId: string,
  payload: EbayOfferPayload,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  // eBay returns 204 No Content on a successful offer update — no body to
  // parse, so this uses ebayFetch directly rather than ebayJson (which always
  // calls response.json() and would throw "Unexpected end of JSON input").
  const response = await ebayFetch(
    config,
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    accessToken,
    { method: "PUT", body: JSON.stringify(payload) },
    fetchImpl,
  );
  if (!response.ok && response.status !== 204) {
    throw await readEbayApiError(response, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`);
  }
}

export async function getOfferBySku(
  config: EbayConfig,
  sku: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const result = await ebayJson<{ offers?: Array<{ offerId?: string }> }>(
      config,
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${config.marketplaceId}`,
      accessToken,
      {},
      fetchImpl,
    );
    return result.offers?.[0]?.offerId ?? null;
  } catch {
    return null;
  }
}

export async function publishEbayOffer(
  config: EbayConfig,
  offerId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EbayPublishResponse> {
  return ebayJson<EbayPublishResponse>(
    config,
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
    accessToken,
    { method: "POST", body: JSON.stringify({}) },
    fetchImpl,
  );
}
