import type { CardFinish, CardRef, Game, Language, PrintEdition } from "../domain/types.js";

export interface IntakeFormSnapshot {
  name: string;
  setName: string;
  number: string;
  cost: string;
  quantity: string;
}

export interface CardIntakeFields {
  name: string;
  setName?: string | null;
  number?: string | null;
  tcgApiId?: string | null;
  tcgDexId?: string | null;
  cardmarketId?: string | null;
  edition?: PrintEdition | null;
  finish?: CardFinish | null;
  game?: Game | null;
  language?: Language | null;
}

export interface IntakePreferences {
  source: string;
  location: string;
  condition: string;
  channel: string;
  strategy: string;
  listingState: "DRAFT" | "ACTIVE";
  keepBuying: boolean;
}

export const DEFAULT_INTAKE_PREFERENCES: IntakePreferences = {
  source: "Card fair",
  location: "Box A",
  condition: "NM",
  channel: "EBAY",
  strategy: "market",
  listingState: "DRAFT",
  keepBuying: true,
};

const validChannels = new Set(["EBAY", "CARDMARKET", "VINTED", "IN_PERSON"]);
const validStrategies = new Set(["quick", "market", "patient"]);
const validListingStates = new Set(["DRAFT", "ACTIVE"]);

export function parseIntakeQuantity(value: string): number | null {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0) return null;
  return quantity;
}

/**
 * Builds the card portion of an intake request without serialising blank
 * optional fields. The API treats an omitted set/number as unknown; an empty
 * string is not a card identity and used to make otherwise valid buys fail.
 */
export function buildCardIntakePayload(input: CardIntakeFields): CardRef {
  const setName = cleanText(input.setName);
  const number = cleanText(input.number);
  const tcgApiId = cleanText(input.tcgApiId);
  const tcgDexId = cleanText(input.tcgDexId);
  const cardmarketId = cleanText(input.cardmarketId);

  return {
    name: cleanText(input.name),
    ...(setName ? { setName } : {}),
    ...(number ? { number } : {}),
    ...(tcgApiId ? { tcgApiId } : {}),
    ...(tcgDexId ? { tcgDexId } : {}),
    ...(cardmarketId ? { cardmarketId } : {}),
    ...(input.edition ? { edition: input.edition } : {}),
    ...(input.finish ? { finish: input.finish } : {}),
    ...(input.game ? { game: input.game } : {}),
    ...(input.language ? { language: input.language } : {}),
  };
}

/** Returns a marketplace-safe draft price, or null when review must set it. */
export function intakeDraftListPricePence(
  channel: string,
  createListing: boolean,
  pricePence: number,
): number | null {
  if (!createListing || !Number.isInteger(pricePence) || pricePence <= 0) return null;
  if (channel === "EBAY" && pricePence < 99) return null;
  return pricePence;
}

/** Guards a captured scan photo against being reused for a different card. */
export function sameCardIntakeIdentity(
  left: { name: string; setName?: string | null; number?: string | null },
  right: { name: string; setName?: string | null; number?: string | null },
): boolean {
  const normalize = (value: string | null | undefined) =>
    (value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (normalize(left.name) !== normalize(right.name)) return false;
  const leftNumber = normalize(left.number);
  const rightNumber = normalize(right.number);
  if (leftNumber || rightNumber) return Boolean(leftNumber && rightNumber && leftNumber === rightNumber);
  const leftSet = normalize(left.setName);
  const rightSet = normalize(right.setName);
  return (!leftSet && !rightSet) || Boolean(leftSet && rightSet && leftSet === rightSet);
}

export function nextIntakeFormAfterStock(
  current: IntakeFormSnapshot,
  keepBuying: boolean,
): IntakeFormSnapshot {
  if (!keepBuying) return current;
  return {
    ...current,
    name: "",
    number: "",
    cost: "",
    quantity: "1",
  };
}

export function parseIntakePreferences(
  value: string | null | undefined,
  fallback: IntakePreferences = DEFAULT_INTAKE_PREFERENCES,
): IntakePreferences {
  if (!value) return { ...fallback };
  try {
    const parsed = JSON.parse(value);
    return normalizeIntakePreferences(parsed, fallback);
  } catch {
    return { ...fallback };
  }
}

export function serializeIntakePreferences(preferences: IntakePreferences): string {
  return JSON.stringify(normalizeIntakePreferences(preferences, DEFAULT_INTAKE_PREFERENCES));
}

export function normalizeIntakePreferences(
  value: unknown,
  fallback: IntakePreferences = DEFAULT_INTAKE_PREFERENCES,
): IntakePreferences {
  const row = value as Partial<IntakePreferences> | null;
  const source = cleanText(row?.source) || fallback.source;
  const location = cleanText(row?.location) || fallback.location;
  const condition = cleanText(row?.condition) || fallback.condition;
  const channel = validChannels.has(cleanText(row?.channel)) ? cleanText(row?.channel) : fallback.channel;
  const strategy = validStrategies.has(cleanText(row?.strategy)) ? cleanText(row?.strategy) : fallback.strategy;
  const listingState = validListingStates.has(cleanText(row?.listingState))
    ? (cleanText(row?.listingState) as IntakePreferences["listingState"])
    : fallback.listingState;
  const keepBuying = typeof row?.keepBuying === "boolean" ? row.keepBuying : fallback.keepBuying;

  return {
    source,
    location,
    condition,
    channel,
    strategy,
    listingState,
    keepBuying,
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
