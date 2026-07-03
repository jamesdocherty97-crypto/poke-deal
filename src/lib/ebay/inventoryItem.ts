// eBay Inventory Item API helpers.
// Maps a ListingPackInput to an eBay inventory item payload and upserts it.

import type { EbayConfig } from "./config.js";
import { ebayFetch } from "./client.js";
import { readEbayApiError } from "./errors.js";
import type { ListingPackInput } from "../dealer/listingPack.js";
import { buildListingPack, isGradedGrade } from "../dealer/listingPack.js";

export interface EbayConditionDescriptor {
  name: string;
  values: string[];
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

const PROFESSIONAL_GRADER_IDS: Record<string, string> = {
  PSA: "275010",
  BCCG: "275011",
  BVG: "275012",
  BGS: "275013",
  CSG: "275014",
  CGC: "275015",
  SGC: "275016",
  KSA: "275017",
  GMA: "275018",
  HGA: "275019",
  ISA: "2750110",
  PCA: "2750111",
  GSG: "2750112",
  PGS: "2750113",
  MNT: "2750114",
  TAG: "2750115",
  RARE: "2750116",
  RCG: "2750117",
  PCG: "2750118",
  ACE: "2750119",
  CGA: "2750120",
  TCG: "2750121",
  ARK: "2750122",
};
const PROFESSIONAL_GRADER_OTHER_ID = "2750123";

const GRADE_VALUE_IDS: Record<string, string> = {
  "10": "275020",
  "9.5": "275021",
  "9": "275022",
  "8.5": "275023",
  "8": "275024",
  "7.5": "275025",
  "7": "275026",
  "6.5": "275027",
  "6": "275028",
  "5.5": "275029",
  "5": "2750210",
  "4.5": "2750211",
  "4": "2750212",
  "3.5": "2750213",
  "3": "2750214",
  "2.5": "2750215",
  "2": "2750216",
  "1.5": "2750217",
  "1": "2750218",
};

// eBay category 183454 (Pokemon UK) only supports these 4 of the 7 possible
// Ungraded Card Condition values (the others are sports-card-only buckets).
const NEAR_MINT_OR_BETTER_ID = "400010";
const LIGHTLY_PLAYED_ID = "400015";
const MODERATELY_PLAYED_ID = "400016";
const HEAVILY_PLAYED_ID = "400017";

/** Best-effort classification of our free-text raw condition into eBay's 4 supported buckets for 183454. */
function ungradedCardConditionId(conditionText?: string | null): string {
  const t = (conditionText ?? "").trim().toLowerCase();
  if (/(^|\b)(hp|heavily ?played|poor|damaged|heavy ?wear)(\b|$)/.test(t)) return HEAVILY_PLAYED_ID;
  if (/(^|\b)(mp|moderately ?played|very ?good|vg|moderate ?wear)(\b|$)/.test(t)) return MODERATELY_PLAYED_ID;
  if (/(^|\b)(lp|lightly ?played|excellent|ex|light ?wear|edgewear|whitening)(\b|$)/.test(t)) return LIGHTLY_PLAYED_ID;
  // Default (includes empty/"NM"/"Near Mint"/"Mint"/anything unrecognized) —
  // matches the rest of the app's existing fallback-to-"Near Mint" convention.
  return NEAR_MINT_OR_BETTER_ID;
}

/** Parses a grade like "PSA_9_5" -> { grader: "PSA", gradeValue: "9.5" }; "ACE_10" -> { grader: "ACE", gradeValue: "10" }. */
function parseGradedGrade(grade: string): { grader: string; gradeValue: string } {
  const parts = grade.split("_");
  const grader = parts[0] ?? "";
  const gradeValue = parts.slice(1).join(".");
  return { grader, gradeValue };
}

function buildConditionFields(input: ListingPackInput): {
  condition: string;
  conditionDescriptors: EbayConditionDescriptor[];
} {
  if (isGradedGrade(input.grade)) {
    const { grader, gradeValue } = parseGradedGrade(input.grade);
    const graderId = PROFESSIONAL_GRADER_IDS[grader] ?? PROFESSIONAL_GRADER_OTHER_ID;
    const conditionDescriptors: EbayConditionDescriptor[] = [
      { name: "27501", values: [graderId] },
    ];
    const gradeId = GRADE_VALUE_IDS[gradeValue];
    if (gradeId) conditionDescriptors.push({ name: "27502", values: [gradeId] });
    if (input.certNumber) conditionDescriptors.push({ name: "27503", values: [input.certNumber] });
    return { condition: GRADED_CONDITION_ENUM, conditionDescriptors };
  }
  return {
    condition: UNGRADED_CONDITION_ENUM,
    conditionDescriptors: [{ name: "40001", values: [ungradedCardConditionId(input.condition)] }],
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
