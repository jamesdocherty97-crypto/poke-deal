// eBay Inventory Item API helpers.
// Maps a ListingPackInput to an eBay inventory item payload and upserts it.

import type { EbayConfig } from "./config.js";
import { ebayFetch } from "./client.js";
import type { ListingPackInput } from "../dealer/listingPack.js";
import { buildListingPack, isGradedGrade } from "../dealer/listingPack.js";

export interface EbayInventoryItem {
  product: {
    title: string;
    description: string;
    imageUrls?: string[];
    aspects: Record<string, string[]>;
  };
  condition: string;
  conditionDescription?: string;
  availability: {
    shipToLocationAvailability: { quantity: number };
  };
  packageWeightAndSize?: {
    dimensions?: { length: number; width: number; height: number; unit: "CENTIMETER" };
    weight?: { value: number; unit: "GRAM" };
  };
}

// eBay ConditionEnum values for Trading Cards category
function conditionEnum(grade: string): string {
  return isGradedGrade(grade) ? "GRADED" : "LIKE_NEW";
}

export function buildInventoryItemPayload(
  input: ListingPackInput,
  quantity: number,
  imageUrl?: string | null,
): EbayInventoryItem {
  const pack = buildListingPack(input);

  // Convert flat item specifics to eBay aspects format (each value is an array)
  const aspects: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(pack.itemSpecifics)) {
    aspects[k] = [v];
  }

  const payload: EbayInventoryItem = {
    product: {
      title: pack.title,
      description: pack.description,
      aspects,
    },
    condition: conditionEnum(input.grade),
    conditionDescription: pack.conditionNote,
    availability: {
      shipToLocationAvailability: { quantity: Math.max(1, quantity) },
    },
    packageWeightAndSize: {
      // Standard Pokémon card sleeve in toploader
      dimensions: { length: 9, width: 6, height: 1, unit: "CENTIMETER" },
      weight: { value: 10, unit: "GRAM" },
    },
  };

  if (imageUrl) {
    payload.product.imageUrls = [imageUrl];
  }

  return payload;
}

export async function upsertInventoryItem(
  config: EbayConfig,
  sku: string,
  payload: EbayInventoryItem,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await ebayFetch(
    config,
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    accessToken,
    { method: "PUT", body: JSON.stringify(payload) },
    fetchImpl,
  );
  // 204 = updated, 201 = created, both are success
  if (!response.ok && response.status !== 204 && response.status !== 201) {
    let msg = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as {
        errors?: Array<{ longMessage?: string; message?: string }>;
      };
      msg = body.errors?.[0]?.longMessage ?? body.errors?.[0]?.message ?? msg;
    } catch {
      // ignore
    }
    throw new Error(`eBay inventory item upsert failed: ${msg}`);
  }
}
