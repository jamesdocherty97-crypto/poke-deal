// eBay Inventory Item API helpers.
// Maps a ListingPackInput to an eBay inventory item payload and upserts it.

import type { EbayConfig } from "./config.js";
import { ebayFetch } from "./client.js";
import { readEbayApiError } from "./errors.js";
import type { ListingPackInput } from "../dealer/listingPack.js";
import { buildListingPack, isGradedGrade, normalizeListingRawCondition } from "../dealer/listingPack.js";
import { ebayCardConditionIds, parseGradedGrade } from "./cardConditionIds.js";

export interface EbayConditionDescriptor {
  name: string;
  values?: string[];
  additionalInfo?: string;
}

export interface EbayInventoryItem {
  product: {
    title: string;
    description: string;
    imageUrls?: string[];
    aspects: Record<string, string[]>;
  };
  condition: string;
  conditionDescription?: string;
  conditionDescriptors?: EbayConditionDescriptor[];
  availability: {
    shipToLocationAvailability: { quantity: number };
  };
  packageWeightAndSize?: {
    dimensions?: { length: number; width: number; height: number; unit: "CENTIMETER" };
    weight?: { value: number; unit: "GRAM" };
  };
}

// eBay's CCG Individual Cards categories (183050 trading cards, 183454 Pokemon
// UK, 261328 sports cards) don't use ordinary condition values. Per eBay's
// "Condition Descriptor IDs for Trading Cards" reference, they reuse two
// existing ConditionEnum values to mean something specific to this category:
//   LIKE_NEW        -> "Graded" (must be paired with conditionDescriptors
//                       27501 Professional Grader + 27502 Grade)
//   USED_VERY_GOOD  -> "Ungraded" (must be paired with conditionDescriptor
//                       40001 Card Condition)
// Sending a plain/free-form value like "GRADED" (not a real ConditionEnum
// value) or omitting conditionDescriptors entirely is rejected by eBay at
// publish time with errors like "Professional Grader (27501) is a required
// field." — this previously went undetected because draft/offer creation
// succeeds either way; only publish enforces it.
const GRADED_CONDITION_ENUM = "LIKE_NEW";
const UNGRADED_CONDITION_ENUM = "USED_VERY_GOOD";

export function validateEbayRawCondition(grade: string, condition?: string | null): string | null {
  return isGradedGrade(grade) || normalizeListingRawCondition(condition)
    ? null
    : "Record the raw card's inspected condition in Stock (NM, LP, MP, HP or DMG) before sending it to eBay.";
}

function buildConditionFields(input: ListingPackInput): {
  condition: string;
  conditionDescriptors: EbayConditionDescriptor[];
} {
  if (isGradedGrade(input.grade)) {
    const { grader, gradeValue } = parseGradedGrade(input.grade);
    const ids = ebayCardConditionIds({ graded: true, grader, gradeValue });
    const conditionDescriptors: EbayConditionDescriptor[] = [];
    if (ids.graderId) conditionDescriptors.push({ name: "27501", values: [ids.graderId] });
    if (ids.gradeId) conditionDescriptors.push({ name: "27502", values: [ids.gradeId] });
    if (input.certNumber) conditionDescriptors.push({ name: "27503", additionalInfo: input.certNumber });
    return { condition: GRADED_CONDITION_ENUM, conditionDescriptors };
  }
  const ids = ebayCardConditionIds({
    graded: false,
    rawCondition: normalizeListingRawCondition(input.condition),
  });
  if (!ids.cardConditionId) throw new Error(validateEbayRawCondition(input.grade, input.condition)!);
  return {
    condition: UNGRADED_CONDITION_ENUM,
    conditionDescriptors: [{ name: "40001", values: [ids.cardConditionId] }],
  };
}

export function buildInventoryItemPayload(
  input: ListingPackInput,
  quantity: number,
  imageUrls?: string[] | string | null,
): EbayInventoryItem {
  const pack = buildListingPack(input);

  // Convert flat item specifics to eBay aspects format (each value is an array)
  const aspects: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(pack.itemSpecifics)) {
    aspects[k] = [v];
  }

  const { condition, conditionDescriptors } = buildConditionFields(input);

  const payload: EbayInventoryItem = {
    product: {
      title: pack.title,
      description: pack.description,
      aspects,
    },
    condition,
    conditionDescription: pack.conditionNote,
    conditionDescriptors,
    availability: {
      shipToLocationAvailability: { quantity: Math.max(1, quantity) },
    },
    packageWeightAndSize: {
      // Standard Pokémon card sleeve in toploader
      dimensions: { length: 9, width: 6, height: 1, unit: "CENTIMETER" },
      weight: { value: 10, unit: "GRAM" },
    },
  };

  const urls = Array.isArray(imageUrls) ? imageUrls : imageUrls ? [imageUrls] : [];
  const cleanUrls = urls.map((url) => url.trim()).filter(Boolean).slice(0, 12);
  if (cleanUrls.length > 0) {
    payload.product.imageUrls = cleanUrls;
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
    throw await readEbayApiError(response, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
  }
}
