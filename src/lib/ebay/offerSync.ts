import type { EbayConfig } from "./config.js";
import { upsertInventoryItem } from "./inventoryItem.js";
import {
  createEbayOffer,
  getOfferBySku,
  updateEbayOffer,
} from "./offer.js";
import type { EbayOfferPreflight } from "./preflight.js";

export const EBAY_UK_MIN_LIST_PRICE_PENCE = 99;

/**
 * Validate the price the user explicitly chose for eBay.
 *
 * Suggested prices are deliberately not accepted here: a comp may inform the
 * choice, but it must never silently become the live marketplace price.
 */
export function validateEbayListPricePence(
  listPricePence: number | null | undefined,
): string | null {
  if (!Number.isInteger(listPricePence) || (listPricePence ?? 0) <= 0) {
    return "Set Your list price before publishing to eBay. This is the sell price sent to eBay, not What I paid or the market comp.";
  }
  if (listPricePence! < EBAY_UK_MIN_LIST_PRICE_PENCE) {
    return "Your list price must be at least £0.99 for eBay UK. Change Your list price; What I paid can still be £0.00 or £0.01.";
  }
  return null;
}

export interface EbayOfferSyncInput {
  config: EbayConfig;
  accessToken: string;
  preflight: EbayOfferPreflight;
  /** Exact user-selected sell price represented by the preflight payload. */
  listPricePence: number;
  /** Offer already associated with this app listing, when known. */
  offerId?: string | null;
}

export interface EbayOfferSyncResult {
  offerId: string;
  created: boolean;
  syncedPricePence: number;
}

export interface EbayOfferSyncDependencies {
  upsertInventoryItem: typeof upsertInventoryItem;
  getOfferBySku: typeof getOfferBySku;
  createEbayOffer: typeof createEbayOffer;
  updateEbayOffer: typeof updateEbayOffer;
}

const DEFAULT_DEPENDENCIES: EbayOfferSyncDependencies = {
  upsertInventoryItem,
  getOfferBySku,
  createEbayOffer,
  updateEbayOffer,
};

/**
 * Make the remote inventory item and offer match the latest preflight exactly.
 * Safe to call immediately before every publish.
 */
export async function synchronizeEbayOffer(
  input: EbayOfferSyncInput,
  dependencies: EbayOfferSyncDependencies = DEFAULT_DEPENDENCIES,
): Promise<EbayOfferSyncResult> {
  const { config, accessToken, preflight } = input;
  const priceError = validateEbayListPricePence(input.listPricePence);
  if (priceError) throw new Error(priceError);

  const payloadPricePence = Math.round(
    Number(preflight.offer.pricingSummary.price.value) * 100,
  );
  if (payloadPricePence !== input.listPricePence) {
    throw new Error(
      "The eBay offer payload does not match Your list price. Refresh the listing and try again.",
    );
  }

  await dependencies.upsertInventoryItem(
    config,
    preflight.sku,
    preflight.inventoryItem,
    accessToken,
  );

  const knownOfferId = input.offerId?.trim() || null;
  const offerId = knownOfferId
    ?? await dependencies.getOfferBySku(config, preflight.sku, accessToken);

  if (offerId) {
    await dependencies.updateEbayOffer(
      config,
      offerId,
      preflight.offer,
      accessToken,
    );
    return { offerId, created: false, syncedPricePence: input.listPricePence };
  }

  const created = await dependencies.createEbayOffer(
    config,
    preflight.offer,
    accessToken,
  );
  return {
    offerId: created.offerId,
    created: true,
    syncedPricePence: input.listPricePence,
  };
}
