import { getAllSets } from "../catalog/setCatalog.js";
import { normalizeSearchText } from "../catalog/fuzzy.js";
import type { Grade } from "../domain/types.js";
import type { PsaCertResult } from "./types.js";

export interface PsaLookupFields {
  name?: string;
  setName?: string;
  number?: string;
  grade?: Grade | null;
}

export function buildPsaLookupFields(result: PsaCertResult): PsaLookupFields {
  if (!result.found) return {};
  return {
    ...(result.subject ? { name: titleCase(result.subject) } : {}),
    ...(result.brand ? { setName: inferPsaSetName(result.brand) } : {}),
    ...(result.cardNumber ? { number: result.cardNumber.trim() } : {}),
    grade: result.grade,
  };
}

export function isPsaPokemonTcgCert(result: PsaCertResult): boolean {
  if (!result.found) return false;
  const brand = normalizeSearchText(result.brand ?? "");
  const category = normalizeSearchText(result.category ?? "");
  return brand.includes("pokemon") && (category.includes("tcg") || category.includes("card"));
}

export function buildPsaCompSearchParams(searchParams: URLSearchParams, result: PsaCertResult): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  const fields = buildPsaLookupFields(result);

  if (fields.name && !hasAny(next, "q", "query", "search", "name", "cardName", "card")) {
    next.set("name", fields.name);
  }
  if (fields.setName && !hasAny(next, "set", "setName")) {
    next.set("set", fields.setName);
  }
  if (fields.number && !hasAny(next, "number", "collectorNumber", "cardNumber")) {
    next.set("number", fields.number);
  }
  if (fields.grade) {
    next.set("grade", fields.grade);
  }

  return next;
}

export function inferPsaSetName(brand: string | undefined): string | undefined {
  const normalizedBrand = normalizeSearchText(brand ?? "");
  if (!normalizedBrand) return undefined;

  const promo = promoSetName(normalizedBrand);
  if (promo) return promo;

  const brandWords = normalizedBrand.split(" ");
  let best: { name: string; index: number; tokenCount: number } | null = null;

  for (const set of getAllSets()) {
    const setText = normalizeSearchText(set.name);
    if (!setText) continue;
    const index = phraseIndex(brandWords, setText.split(" "));
    if (index < 0) continue;
    const tokenCount = setText.split(" ").length;
    if (
      !best ||
      index > best.index ||
      (index === best.index && tokenCount > best.tokenCount)
    ) {
      best = { name: set.name, index, tokenCount };
    }
  }

  return best?.name;
}

function promoSetName(normalizedBrand: string): string | undefined {
  if (!/\bpromos?\b|\bpromo\b/.test(normalizedBrand)) return undefined;
  if (hasPhrase(normalizedBrand, "scarlet violet") || hasPhrase(normalizedBrand, "scarlet and violet")) {
    return "Scarlet & Violet Black Star Promos";
  }
  if (hasPhrase(normalizedBrand, "sword shield") || hasPhrase(normalizedBrand, "sword and shield")) {
    return "SWSH Black Star Promos";
  }
  if (hasPhrase(normalizedBrand, "sun moon") || hasPhrase(normalizedBrand, "sun and moon")) {
    return "SM Black Star Promos";
  }
  if (normalizedBrand.includes("xy")) return "XY Black Star Promos";
  if (hasPhrase(normalizedBrand, "black white") || hasPhrase(normalizedBrand, "black and white")) {
    return "BW Black Star Promos";
  }
  return undefined;
}

function hasPhrase(normalizedText: string, phrase: string): boolean {
  return ` ${normalizedText} `.includes(` ${phrase} `);
}

function hasAny(searchParams: URLSearchParams, ...keys: string[]): boolean {
  return keys.some((key) => {
    const value = searchParams.get(key)?.trim();
    return Boolean(value && !["undefined", "null", "none", "n/a"].includes(value.toLowerCase()));
  });
}

function phraseIndex(words: string[], phrase: string[]): number {
  if (phrase.length === 0 || phrase.length > words.length) return -1;
  for (let i = words.length - phrase.length; i >= 0; i -= 1) {
    if (phrase.every((word, offset) => words[i + offset] === word)) return i;
  }
  return -1;
}

function titleCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (char) => char.toUpperCase())
    .replace(/\bVmax\b/g, "VMAX")
    .replace(/\bVstar\b/g, "VSTAR")
    .replace(/\bEx\b/g, "ex")
    .replace(/\bGx\b/g, "GX");
}
