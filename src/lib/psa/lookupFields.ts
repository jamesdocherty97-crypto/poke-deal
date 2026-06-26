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
