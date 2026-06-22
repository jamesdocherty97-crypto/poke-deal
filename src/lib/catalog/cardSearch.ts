import type { CatalogCard } from "./types.js";
import { normalizeSearchText, scoreSearchText } from "./fuzzy.js";

export interface CardSearchOptions {
  setName?: string;
  limit?: number;
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
  const nameScore = scoreSearchText(query, card.name);
  const numberScore = card.number && normalizeSearchText(query) === normalizeSearchText(card.number) ? 650 : 0;
  if (nameScore === 0 && numberScore === 0) return 0;

  let score = nameScore * 4 + numberScore;
  if (setName?.trim()) {
    const setScore = Math.max(
      scoreSearchText(setName, card.setName),
      scoreSearchText(setName, card.setCode ?? ""),
    );
    if (setScore === 0) score -= 260;
    else score += setScore;
  }
  if (card.imageUrl) score += 8;
  if (card.tcgApiId) score += 10;
  return score;
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

function tieBreakCard(a: CatalogCard, b: CatalogCard): number {
  const aNumber = Number.parseInt(a.number ?? "", 10);
  const bNumber = Number.parseInt(b.number ?? "", 10);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
    return aNumber - bNumber;
  }
  return a.name.localeCompare(b.name);
}
