import type { ListingPackInput } from "../dealer/listingPack.js";
import { buildListingPack } from "../dealer/listingPack.js";
import type { EbayConfig } from "./config.js";
import type { EbayInventoryItem } from "./inventoryItem.js";
import { buildInventoryItemPayload } from "./inventoryItem.js";
import type { EbayOfferPayload } from "./offer.js";
import { buildOfferPayload } from "./offer.js";
import type { EbayPolicies } from "./policies.js";

export interface EbayPolicySummary {
  payment: { id: string; name?: string; default?: boolean };
  fulfillment: { id: string; name?: string; default?: boolean };
  returns: { id: string; name?: string; default?: boolean };
  merchantLocation: { key: string | null; name?: string; status?: string; configuredKeyMatched?: boolean };
}

export interface EbayOfferPreflightInput {
  listingId: string;
  itemId?: string;
  packInput: ListingPackInput;
  quantity: number;
  imageUrls?: string[];
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
  policySummary: EbayPolicySummary;
  inventoryItem: EbayInventoryItem;
  offer: EbayOfferPayload;
}

export function toEbaySku(listingId: string, itemId?: string | null): string {
  return `pdos-${(itemId?.trim() || listingId).trim()}`;
}

export function buildEbayOfferPreflight(input: EbayOfferPreflightInput): EbayOfferPreflight {
  const pack = buildListingPack(input.packInput);
  const sku = toEbaySku(input.listingId, input.itemId);
  const quantity = Math.max(1, input.quantity);
  const imageUrls = (input.imageUrls ?? []).map((url) => url.trim()).filter(Boolean).slice(0, 12);
  const inventoryItem = buildInventoryItemPayload(input.packInput, quantity, imageUrls);
  const offer = buildOfferPayload(sku, pack, input.policies, input.config, quantity);

  return {
    sku,
    title: pack.title,
    priceGbp: (pack.suggestedPricePence / 100).toFixed(2),
    quantity,
    marketplaceId: offer.marketplaceId,
    categoryId: offer.categoryId,
    hasImage: imageUrls.length > 0,
    policyKeys: {
      paymentPolicyId: Boolean(input.policies.paymentPolicyId),
      fulfillmentPolicyId: Boolean(input.policies.fulfillmentPolicyId),
      returnPolicyId: Boolean(input.policies.returnPolicyId),
      merchantLocationKey: Boolean(input.policies.merchantLocationKey),
    },
    policySummary: {
      payment: {
        id: input.policies.paymentPolicyId,
        name: input.policies.paymentPolicy?.name,
        default: input.policies.paymentPolicy?.default,
      },
      fulfillment: {
        id: input.policies.fulfillmentPolicyId,
        name: input.policies.fulfillmentPolicy?.name,
        default: input.policies.fulfillmentPolicy?.default,
      },
      returns: {
        id: input.policies.returnPolicyId,
        name: input.policies.returnPolicy?.name,
        default: input.policies.returnPolicy?.default,
      },
      merchantLocation: {
        key: input.policies.merchantLocationKey,
        name: input.policies.merchantLocation?.name,
        status: input.policies.merchantLocation?.status,
        configuredKeyMatched: input.policies.merchantLocation?.configuredKeyMatched,
      },
    },
    inventoryItem,
    offer,
  };
}
