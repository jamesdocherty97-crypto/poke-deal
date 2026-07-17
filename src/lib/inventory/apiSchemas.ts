import { z } from "zod";
import { GRADE_VALUES } from "../domain/types.js";

const optionalCardText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const cardIdentityFields = {
  name: z.string().trim().min(1),
  setName: optionalCardText,
  number: optionalCardText,
  tcgApiId: optionalCardText,
  tcgDexId: optionalCardText,
  cardmarketId: optionalCardText,
  language: z.enum(["EN", "JP"]).default("EN"),
  edition: z.enum(["UNLIMITED", "FIRST_EDITION", "SHADOWLESS", "STAFF", "PRERELEASE"]).optional(),
  finish: z.enum(["NORMAL", "HOLO", "REVERSE_HOLO"]).optional(),
} as const;

const reviewedCompResultSchema = z.object({
  source: z.string().trim().min(1).max(100),
  medianPence: z.coerce.number().int().nonnegative(),
  meanPence: z.coerce.number().int().nonnegative(),
  lowPence: z.coerce.number().int().nonnegative(),
  highPence: z.coerce.number().int().nonnegative(),
  sampleSize: z.coerce.number().int().positive(),
  windowDays: z.coerce.number().int().positive().max(730),
  trendPct: z.coerce.number().finite().nullable(),
  outliersRemoved: z.coerce.number().int().nonnegative(),
  asOf: z.string().datetime({ offset: true }),
});

export const acquireRequestSchema = z.object({
  card: z.object(cardIdentityFields),
  grade: z.enum(GRADE_VALUES).default("RAW"),
  costBasisPence: z.coerce.number().int().nonnegative(),
  quantity: z.coerce.number().int().positive().default(1),
  acquiredFrom: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  condition: z.string().trim().min(1).optional(),
  graderCert: z.string().trim().min(1).optional(),
  strategy: z.enum(["quick", "market", "patient"]).default("market"),
  minMargin: z.coerce.number().min(0).max(5).optional(),
  channel: z.enum(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]).default("EBAY"),
  listPricePence: z.coerce.number().int().nonnegative().optional(),
  listingState: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
  createListing: z.boolean().default(true),
  checkedComp: z
    .object({
      pricePence: z.coerce.number().int().positive(),
      sampleSize: z.coerce.number().int().positive().default(1),
      windowDays: z.coerce.number().int().positive().max(365).default(30),
      source: z.enum(["EBAY_SOLD", "CARDMARKET", "TCGPLAYER", "OTHER"]).default("EBAY_SOLD"),
      note: z.string().trim().min(1).optional(),
    })
    .optional(),
  /** The comp receipt the user just reviewed in the intake UI. */
  reviewedComps: z
    .object({
      headline: reviewedCompResultSchema,
      all: z.array(reviewedCompResultSchema).min(1).max(12),
      sourcesDisagree: z.boolean(),
    })
    .optional(),
});

export const inventoryDraftRequestSchema = z.object({
  card: z.object({
    id: optionalCardText,
    ...cardIdentityFields,
    game: z.enum(["POKEMON", "SOCCER"]).default("POKEMON"),
  }),
  grade: z.enum(GRADE_VALUES).default("RAW"),
  quantity: z.coerce.number().int().positive().default(1),
  costBasisPence: z.coerce.number().int().nonnegative(),
  acquiredFrom: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  condition: z.string().trim().min(1).optional(),
  graderCert: z.string().trim().min(1).optional(),
  status: z.enum(["IN_STOCK", "LISTED", "SOLD", "RESERVED"]).default("IN_STOCK"),
});
