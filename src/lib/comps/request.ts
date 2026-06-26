import { normalizeCatalogCardSearchInput } from "../catalog/cardSearch.js";
import type { CardRef, Grade } from "../domain/types.js";
import { normalizeGradeLabel } from "./cleaning.js";
import { textMentionsFirstEdition } from "./variants.js";

export interface CompLookupRequest {
  card: CardRef;
  grade: Grade;
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
  const parsedNameParam = rawNameParam ? normalizeCatalogCardSearchInput(rawNameParam, explicitSetName) : null;
  const rawName = cleanCompRequestName(parsedNameParam?.name ?? parsed?.name);
  const name = cleanCompRequestName(preserveVariantText(rawName, [freeText, rawNameParam].filter(Boolean).join(" ")));

  if (!name?.trim()) return { error: "name is required" };

  const setName = explicitSetName ?? parsed?.setName ?? parsedNameParam?.setName;
  const number = explicitNumber ?? parsed?.number ?? parsedNameParam?.number;
  const grade = normalizeGradeLabel(readFirst(searchParams, "grade")) ?? "RAW";

  return {
    card: {
      name,
      setName,
      number,
      game: "POKEMON",
      language: "EN",
    },
    grade,
  };
}

function readFirst(searchParams: URLSearchParams, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = searchParams.get(key)?.trim();
    if (value) return value;
  }
  return undefined;
}

function preserveVariantText(name: string | undefined, freeText: string | undefined): string | undefined {
  if (!name?.trim()) return name;
  if (!textMentionsFirstEdition(freeText) || textMentionsFirstEdition(name)) return name;
  return `${name.trim()} 1st Edition`;
}

function cleanCompRequestName(name: string | undefined): string | undefined {
  return name
    ?.replace(/\s+-+\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
