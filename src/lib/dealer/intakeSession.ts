export interface IntakeFormSnapshot {
  name: string;
  setName: string;
  number: string;
  cost: string;
  quantity: string;
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
