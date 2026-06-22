import type { CatalogCard } from "./types.js";
import { normalizeSearchText, scoreSearchText } from "./fuzzy.js";
import { getSetById, resolveSetId } from "./setCatalog.js";

export interface CardSearchOptions {
  setName?: string;
  limit?: number;
}

export interface ParsedCardSearchQuery {
  name: string;
  number?: string;
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
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!trimmed) return { name: "" };

  const wholeNumber = readCollectorNumber(trimmed);
  if (wholeNumber) return { name: "", number: wholeNumber };

  const trailing = trimmed.match(/^(.*?)\s+#?([A-Za-z]{1,5}\d{1,4}(?:\/[A-Za-z]{0,5}\d{1,4})?|\d{1,4}\/\d{1,4})$/);
  const name = trailing?.[1]?.trim();
  const number = readCollectorNumber(trailing?.[2]);
  if (name && number) return { name, number };

  return { name: trimmed };
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

function tieBreakCard(a: CatalogCard, b: CatalogCard): number {
  const aNumber = Number.parseInt(a.number ?? "", 10);
  const bNumber = Number.parseInt(b.number ?? "", 10);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
    return aNumber - bNumber;
  }
  return a.name.localeCompare(b.name);
}
