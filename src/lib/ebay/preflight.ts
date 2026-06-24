import type { ListingPackInput } from "../dealer/listingPack.js";
import { buildListingPack } from "../dealer/listingPack.js";
import type { EbayConfig } from "./config.js";
import type { EbayInventoryItem } from "./inventoryItem.js";
import { buildInventoryItemPayload } from "./inventoryItem.js";
import type { EbayOfferPayload } from "./offer.js";
import { buildOfferPayload } from "./offer.js";
import type { EbayPolicies } from "./policies.js";

export interface EbayOfferPreflightInput {
  listingId: string;
  packInput: ListingPackInput;
  quantity: number;
  imageUrl?: string | null;
  policies: EbayPolicies;
  config: EbayConfig;
}

export interface EbayOfferPreflight {
  sku: string;
  title: string;
  priceGbp: string;
  quantity: number;
  marketplaceId: string;
  categoryId: string;
  hasImage: boolean;
  policyKeys: {
    paymentPolicyId: boolean;
    fulfillmentPolicyId: boolean;
    returnPolicyId: boolean;
    merchantLocationKey: boolean;
  };
  inventoryItem: EbayInventoryItem;
  offer: EbayOfferPayload;
}

export function toEbaySku(listingId: string): string {
  return `pdos-${listingId}`;
}

export function buildEbayOfferPreflight(input: EbayOfferPreflightInput): EbayOfferPreflight {
  const pack = buildListingPack(input.packInput);
  const sku = toEbaySku(input.listingId);
  const quantity = Math.max(1, input.quantity);
  const inventoryItem = buildInventoryItemPayload(input.packInput, quantity, input.imageUrl);
  const offer = buildOfferPayload(sku, pack, input.policies, input.config, quantity);

  return {
    sku,
    title: pack.title,
    priceGbp: (pack.suggestedPricePence / 100).toFixed(2),
    quantity,
    marketplaceId: offer.marketplaceId,
    categoryId: offer.categoryId,
    hasImage: Boolean(input.imageUrl),
    policyKeys: {
      paymentPolicyId: Boolean(input.policies.paymentPolicyId),
      fulfillmentPolicyId: Boolean(input.policies.fulfillmentPolicyId),
      returnPolicyId: Boolean(input.policies.returnPolicyId),
      merchantLocationKey: Boolean(input.policies.merchantLocationKey),
    },
    inventoryItem,
    offer,
  };
}
