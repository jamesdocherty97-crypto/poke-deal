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
  const rawName = readFirst(searchParams, "name", "cardName", "card") ?? parsed?.name;
  const name = preserveVariantText(rawName, freeText);

  if (!name?.trim()) return { error: "name is required" };

  const setName = readFirst(searchParams, "set", "setName") ?? parsed?.setName;
  const number = readFirst(searchParams, "number", "collectorNumber", "cardNumber") ?? parsed?.number;
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
