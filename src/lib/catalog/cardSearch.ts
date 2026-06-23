import type { CatalogCard } from "./types.js";
import { normalizeSearchText, scoreSearchText } from "./fuzzy.js";
import {
  getSetById,
  isApiUnavailableSetId,
  resolveExactSetId,
  resolveSetAliasId,
  resolveSetId,
  resolveSetIdForCard,
  searchSets,
} from "./setCatalog.js";

export interface CardSearchOptions {
  setName?: string;
  limit?: number;
}

export interface ParsedCardSearchQuery {
  name: string;
  number?: string;
}

export interface NormalizedCatalogCardSearchInput {
  query: string;
  name: string;
  setName?: string;
  number?: string;
}

interface SetPhraseMatch {
  phrase: string;
  setName: string;
  score: number;
}

export function rankCatalogCards(
  query: string,
  cards: CatalogCard[],
  options: CardSearchOptions = {},
): CatalogCard[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const limit = options.limit ?? 8;
  const scored = dedupeCards(cards)
    .map((card) => ({
      card,
      score: scoreCatalogCardForSearch(trimmed, card, options.setName),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || tieBreakCard(a.card, b.card));

  return scored.slice(0, limit).map((entry) => entry.card);
}

export function scoreCatalogCardForSearch(query: string, card: CatalogCard, setName?: string): number {
  const parsed = parseCardSearchQuery(query);
  const nameScore = parsed.name ? scoreSearchText(parsed.name, card.name) : 0;
  const numberScore = parsed.number && card.number && sameCollectorNumber(parsed.number, card.number) ? 1100 : 0;
  if (parsed.name && nameScore === 0) return 0;
  if (nameScore === 0 && numberScore === 0) return 0;

  const resolvedSetId = setName?.trim() ? resolveSetId(setName) : undefined;
  if (isApiUnavailableSetId(resolvedSetId) && card.setCode !== resolvedSetId) return 0;

  let score = nameScore * 4 + numberScore;
  if (setName?.trim()) {
    const setScore = scoreSetContextForSearch(setName, card);
    if (setScore === 0) score -= 260;
    else score += setScore;
  }
  if (card.imageUrl) score += 8;
  if (card.tcgApiId) score += 10;
  return score;
}

export function parseCardSearchQuery(query: string): ParsedCardSearchQuery {
  const trimmed = stripLookupNoise(query).trim().replace(/\s+/g, " ");
  if (!trimmed) return { name: "" };

  const wholeNumber = readCollectorNumber(trimmed);
  if (wholeNumber) return { name: "", number: wholeNumber };

  const trailing = trimmed.match(/^(.*?)\s+#?([A-Za-z]{1,5}\d{1,4}(?:\/[A-Za-z]{0,5}\d{1,4})?|\d{1,4}\/\d{1,4}|\d{1,4})$/);
  const name = trailing?.[1]?.trim();
  const number = readCollectorNumber(trailing?.[2]);
  if (name && number) return { name, number };

  return { name: trimmed };
}

export function normalizeCatalogCardSearchInput(
  query: string,
  explicitSetName?: string,
): NormalizedCatalogCardSearchInput {
  const cleaned = stripLookupNoise(query);
  const parsed = parseCardSearchQuery(cleaned);
  let name = parsed.name || cleaned.trim();
  let number = parsed.number;

  let setName = explicitSetName?.trim() || undefined;
  if (!setName && number && isPlainCollectorNumber(number)) {
    const numericSetId = resolveExactSetId(number);
    if (numericSetId) {
      setName = getSetById(numericSetId)?.name;
      number = undefined;
    }
  }

  if (setName) {
    setName = resolveSetDisplayName(setName, number);
  } else {
    const setMatch = findSetPhraseInName(name, number);
    if (setMatch) {
      setName = setMatch.setName;
      name = removePhrase(name, setMatch.phrase);
    }
  }

  const trailingNumber = !number && setName ? splitTrailingPlainCollectorNumber(name) : null;
  if (trailingNumber) {
    name = trailingNumber.name;
  }

  name = normalizeNameForSearch(name);
  const normalizedNumber = number ?? trailingNumber?.number;
  const normalizedQuery = [name, normalizedNumber].filter(Boolean).join(" ").trim() || cleaned.trim();
  return { query: normalizedQuery, name, setName, number: normalizedNumber };
}

function scoreSetContextForSearch(setName: string, card: CatalogCard): number {
  const directScore = Math.max(
    scoreSearchText(setName, card.setName),
    scoreSearchText(setName, card.setCode ?? ""),
  );
  const resolvedSetId = resolveSetId(setName);
  if (!resolvedSetId) return directScore;

  const resolvedSet = getSetById(resolvedSetId);
  const resolvedScore = Math.max(
    card.setCode === resolvedSetId ? 1000 : 0,
    resolvedSet ? scoreSearchText(resolvedSet.name, card.setName) : 0,
    resolvedSet?.ptcgoCode ? scoreSearchText(resolvedSet.ptcgoCode, card.setCode ?? "") : 0,
  );

  return Math.max(directScore, resolvedScore);
}

function stripLookupNoise(input: string): string {
  return input
    .replace(/(?:£\s*)\d+(?:[.,]\d{1,2})?/gi, " ")
    .replace(/\b(?:paid|cost|buy|bought)\s*(?:£\s*)?\d+(?:[.,]\d{1,2})?\b/gi, " ")
    .replace(/\bbgs\s*9(?:\.|,)?5\b/gi, " ")
    .replace(/\b(?:psa|cgc)\s*(?:9|10)\b/gi, " ")
    .replace(/\b(?:raw|ungraded|nm|near mint)\b/gi, " ")
    .replace(/\b(?:qty|quantity)\s*\d{1,3}\b/gi, " ")
    .replace(/(?:^|\s)(?:x\s*\d{1,3}|\d{1,3}\s*x)(?=\s|$)/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findSetPhraseInName(name: string, number: string | undefined): SetPhraseMatch | null {
  const words = name.split(/\s+/).filter(Boolean);
  let best: SetPhraseMatch | null = null;

  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 1; end <= Math.min(words.length, start + 5); end += 1) {
      const phrase = words.slice(start, end).join(" ");
      const match = scoreSetPhrase(phrase, number);
      if (!match) continue;
      if (!best || match.score > best.score) best = match;
    }
  }

  return best;
}

function scoreSetPhrase(phrase: string, number: string | undefined): SetPhraseMatch | null {
  const normalizedPhrase = normalizeSearchText(phrase);
  if (!normalizedPhrase) return null;
  if (["ex", "gx", "v", "vmax", "vstar"].includes(normalizedPhrase)) return null;

  const set = searchSets(phrase, 1)[0];
  if (!set) return null;

  const resolvedSetName = resolveSetDisplayName(set.name, number);
  const aliasId = resolveSetAliasId(phrase);
  const normalizedSetName = normalizeSearchText(set.name);
  const phraseTokenCount = normalizedPhrase.split(/\s+/).filter(Boolean).length;
  const exactish =
    aliasId === set.id ||
    normalizedPhrase === set.id.toLowerCase() ||
    normalizedPhrase === set.ptcgoCode?.toLowerCase() ||
    normalizedPhrase === normalizedSetName;
  const contextual = phraseTokenCount >= 2 && normalizedSetName.includes(normalizedPhrase);
  if (!exactish && !contextual) return null;

  const score = (exactish ? 1000 : 800) + phraseTokenCount;
  return { phrase, setName: resolvedSetName, score };
}

function resolveSetDisplayName(setName: string, number: string | undefined): string {
  const resolvedId = resolveSetIdForCard(setName, number);
  return (resolvedId && getSetById(resolvedId)?.name) || setName;
}

function removePhrase(input: string, phrase: string): string {
  return input.replace(new RegExp(escapeRegExp(phrase), "i"), " ");
}

function normalizeNameForSearch(input: string): string {
  return input
    .replace(/[()|,;]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function splitTrailingPlainCollectorNumber(input: string): { name: string; number: string } | null {
  const match = input.trim().match(/^(.*?)\s+#?(\d{1,4})$/);
  const name = match?.[1]?.trim();
  const number = match?.[2];
  if (!name || !number) return null;
  return { name, number };
}

function isPlainCollectorNumber(value: string): boolean {
  return /^\d{1,4}$/.test(value);
}

function dedupeCards(cards: CatalogCard[]): CatalogCard[] {
  const seen = new Set<string>();
  const result: CatalogCard[] = [];
  for (const card of cards) {
    const key = card.tcgApiId ?? [
      normalizeSearchText(card.name),
      normalizeSearchText(card.setName),
      normalizeSearchText(card.number ?? ""),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(card);
  }
  return result;
}

function sameCollectorNumber(queryNumber: string, cardNumber: string): boolean {
  const queryForms = collectorNumberForms(queryNumber);
  const cardForms = collectorNumberForms(cardNumber);
  return [...queryForms].some((query) =>
    [...cardForms].some((card) => query === card || query === card.split("/")[0]),
  );
}

function normalizeCollectorNumberForSearch(number: string): string {
  const trimmed = number.trim();
  const parts = trimmed.split("/").map((part) => normalizeSearchText(part));
  const left = parts[0] ?? "";
  const right = parts[1];
  if (!right) return left;

  const prefix = left.match(/^([a-z]{1,5})\d+$/)?.[1];
  if (prefix && /^\d+$/.test(right)) return `${left}/${prefix}${right}`;
  return `${left}/${right}`;
}

function collectorNumberForms(number: string): Set<string> {
  const normalized = normalizeCollectorNumberForSearch(number);
  const forms = new Set([normalized]);
  const left = normalized.split("/")[0] ?? normalized;
  const stripped = stripAlphaPrefix(left);
  if (stripped) forms.add(stripped);
  return forms;
}

function stripAlphaPrefix(value: string): string | undefined {
  const match = value.match(/^[a-z]{2,5}0*(\d{1,4})$/);
  if (!match) return undefined;
  return String(Number.parseInt(match[1]!, 10));
}

function readCollectorNumber(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^(?:[A-Za-z]{1,5}\d{1,4}|\d{1,4})(?:\/[A-Za-z]{0,5}\d{1,4})?$/.test(trimmed)
    ? trimmed
    : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tieBreakCard(a: CatalogCard, b: CatalogCard): number {
  const aNumber = Number.parseInt(a.number ?? "", 10);
  const bNumber = Number.parseInt(b.number ?? "", 10);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
    return aNumber - bNumber;
  }
  return a.name.localeCompare(b.name);
}
