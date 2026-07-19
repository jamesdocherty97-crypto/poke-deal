import { normalizeCatalogCardSearchInput } from "../catalog/cardSearch.js";
import type { CardRef, Grade, RawCondition } from "../domain/types.js";
import { normalizeGradeLabel } from "./cleaning.js";
import { normalizeRawCondition } from "./pricing.js";
import { addRequestedPrintHints } from "./variants.js";

export interface CompLookupRequest {
  card: CardRef;
  grade: Grade;
  condition?: RawCondition;
}

/**
 * Parse comp lookup params from API requests. Accepts both the UI's compact
 * field names and agent/smoke-test friendly aliases.
 */
export function readCompLookupRequest(searchParams: URLSearchParams): CompLookupRequest | { error: string } {
  const freeText = readFirst(searchParams, "q", "query", "search");
  const parsed = freeText ? normalizeCatalogCardSearchInput(freeText) : null;
  const rawNameParam = readFirst(searchParams, "name", "cardName", "card");
  const explicitSetName = readFirst(searchParams, "set", "setName");
  const explicitNumber = readFirst(searchParams, "number", "collectorNumber", "cardNumber");
  const explicitTcgApiId = readFirst(searchParams, "tcgApiId", "pokemonTcgId");
  const explicitTcgDexId = readFirst(searchParams, "tcgDexId");
  const explicitCardmarketId = readFirst(searchParams, "cardmarketId");
  const requestedLanguage = readFirst(searchParams, "language", "lang")?.toUpperCase() === "JP" ? "JP" : "EN";
  const explicitEdition = readFirst(searchParams, "edition")?.toUpperCase();
  const explicitFinish = readFirst(searchParams, "finish")?.toUpperCase();
  const parsedNameParam = rawNameParam ? normalizeCatalogCardSearchInput(rawNameParam, explicitSetName) : null;
  const rawName = cleanCompRequestName(parsedNameParam?.name ?? parsed?.name);
  const variantAwareNameSource = [
    freeText,
    rawNameParam,
    isEdition(explicitEdition) ? explicitEdition.replace(/_/g, " ") : null,
    isFinish(explicitFinish) ? explicitFinish.replace(/_/g, " ") : null,
  ].filter(Boolean).join(" ");
  const name = cleanCompRequestName(addRequestedPrintHints(rawName ?? "", { name: variantAwareNameSource }));

  if (!name?.trim()) return { error: "name is required" };

  const setName = explicitSetName ?? parsed?.setName ?? parsedNameParam?.setName;
  const number = explicitNumber ?? parsed?.number ?? parsedNameParam?.number;
  const explicitGradeText = readFirst(searchParams, "grade");
  const explicitGrade = explicitGradeText ? normalizeGradeLabel(explicitGradeText) ?? undefined : undefined;
  const parsedFreeGrade = parseGradeFromText(readFirst(searchParams, "q", "query", "search") ?? readFirst(searchParams, "name", "cardName", "card"));
  const grade = explicitGrade ?? parsedFreeGrade ?? "RAW";
  const condition = grade === "RAW"
    ? normalizeRawCondition(readFirst(searchParams, "condition", "rawCondition"))
    : null;

  return {
    card: {
      name,
      setName,
      number,
      ...(explicitTcgApiId ? { tcgApiId: explicitTcgApiId } : {}),
      ...(explicitTcgDexId ? { tcgDexId: explicitTcgDexId } : {}),
      ...(explicitCardmarketId ? { cardmarketId: explicitCardmarketId } : {}),
      ...((isEdition(explicitEdition) ? explicitEdition : parsedNameParam?.edition ?? parsed?.edition) ? {
        edition: (isEdition(explicitEdition) ? explicitEdition : parsedNameParam?.edition ?? parsed?.edition)!,
      } : {}),
      ...((isFinish(explicitFinish) ? explicitFinish : parsedNameParam?.finish ?? parsed?.finish) ? {
        finish: (isFinish(explicitFinish) ? explicitFinish : parsedNameParam?.finish ?? parsed?.finish)!,
      } : {}),
      game: "POKEMON",
      language: requestedLanguage,
    },
    grade,
    ...(condition ? { condition } : {}),
  };
}

function isEdition(value: string | undefined): value is NonNullable<CardRef["edition"]> {
  return ["UNLIMITED", "FIRST_EDITION", "SHADOWLESS", "STAFF", "PRERELEASE"].includes(value ?? "");
}

function isFinish(value: string | undefined): value is NonNullable<CardRef["finish"]> {
  return ["NORMAL", "HOLO", "REVERSE_HOLO"].includes(value ?? "");
}

function parseGradeFromText(input: string | undefined): Grade | undefined {
  if (!input) return undefined;

  const rawMatch = input.match(/\b(?:RAW|UNGRADED|NM|NEAR\s+MINT)\b/i);
  if (rawMatch) return "RAW";

  const match = input.match(/\b(?:PSA|BGS|CGC|ACE)\s*(?:10|[1-9](?:[.,][0-9])?)(?:\s*\/\s*5)?/i);
  if (!match?.[0]) return undefined;

  const normalizedMatch = match[0].trim().replace(/\//g, ".");
  return normalizeGradeLabel(normalizedMatch) ?? undefined;
}

function readFirst(searchParams: URLSearchParams, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = searchParams.get(key)?.trim();
    if (!raw) continue;
    const normalized = raw.toLowerCase();
    if (normalized === "undefined" || normalized === "null" || normalized === "none" || normalized === "n/a") continue;
    return raw;
  }
  return undefined;
}

function cleanCompRequestName(name: string | undefined): string | undefined {
  return name
    ?.replace(/\s+-+\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
