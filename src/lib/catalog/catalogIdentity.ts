import { normalizeCollectorNumberForCompare, normalizeSetNameForCompare } from "../cards/identity.js";
import type { CatalogCard, CatalogPriceSignal } from "./types.js";

function normalize(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim().replace(/\s+/g, " ") ?? "";
}

/** Provider IDs identify records; this key identifies the physical printing. */
export function catalogIdentityKey(card: CatalogCard): string {
  return [
    card.game,
    card.language,
    normalizeSetNameForCompare(card.setName),
    normalizeCollectorNumberForCompare(card.number) ?? "",
    normalize(card.name),
    card.edition ?? "",
    card.finish ?? "",
  ].join("|");
}

export function mergeCatalogCards(cards: readonly CatalogCard[]): CatalogCard[] {
  const merged = new Map<string, CatalogCard>();
  for (const card of cards) {
    const key = catalogIdentityKey(card);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeCatalogCard(existing, card) : cloneCard(card));
  }
  return [...merged.values()];
}

export function mergeCatalogCard(primary: CatalogCard, incoming: CatalogCard): CatalogCard {
  const providers = new Set([
    ...(primary.provenance?.providers ?? providerIds(primary)),
    ...(incoming.provenance?.providers ?? providerIds(incoming)),
  ]);
  const live = primary.provenance?.origin === "live" || incoming.provenance?.origin === "live";
  return {
    ...primary,
    setCode: primary.setCode ?? incoming.setCode,
    number: primary.number ?? incoming.number,
    rarity: primary.rarity ?? incoming.rarity,
    imageUrl: bestImage(primary.imageUrl, incoming.imageUrl),
    displayImageUrl: bestImage(primary.displayImageUrl, incoming.displayImageUrl),
    setLogoUrl: bestImage(primary.setLogoUrl, incoming.setLogoUrl),
    setSymbolUrl: bestImage(primary.setSymbolUrl, incoming.setSymbolUrl),
    tcgApiId: primary.tcgApiId ?? incoming.tcgApiId,
    tcgDexId: primary.tcgDexId ?? incoming.tcgDexId,
    cardmarketId: primary.cardmarketId ?? incoming.cardmarketId,
    edition: primary.edition ?? incoming.edition,
    finish: primary.finish ?? incoming.finish,
    priceSignals: mergePriceSignals(primary.priceSignals, incoming.priceSignals),
    provenance: {
      origin: live ? "live" : primary.provenance?.origin ?? incoming.provenance?.origin ?? "curated",
      providers: [...providers],
      retrievedAt: latestIso(primary.provenance?.retrievedAt, incoming.provenance?.retrievedAt),
      cachedAt: latestIso(primary.provenance?.cachedAt, incoming.provenance?.cachedAt),
      expiresAt: latestIso(primary.provenance?.expiresAt, incoming.provenance?.expiresAt),
    },
  };
}

function cloneCard(card: CatalogCard): CatalogCard {
  return {
    ...card,
    priceSignals: card.priceSignals ? [...card.priceSignals] : undefined,
    provenance: card.provenance ? { ...card.provenance, providers: [...card.provenance.providers] } : undefined,
  };
}

function providerIds(card: CatalogCard): string[] {
  return [card.tcgApiId ? "pokemon-tcg-api" : null, card.tcgDexId ? "tcgdex" : null, card.cardmarketId ? "cardmarket" : null]
    .filter((value): value is string => Boolean(value));
}

function mergePriceSignals(left: CatalogPriceSignal[] | undefined, right: CatalogPriceSignal[] | undefined): CatalogPriceSignal[] | undefined {
  const values = [...(left ?? []), ...(right ?? [])];
  if (values.length === 0) return undefined;
  const byKey = new Map<string, CatalogPriceSignal>();
  for (const signal of values) {
    const key = [signal.source, signal.kind, signal.variant ?? "", signal.updatedAt ?? ""].join("|");
    if (!byKey.has(key)) byKey.set(key, signal);
  }
  return [...byKey.values()];
}

function bestImage(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return imageScore(right) > imageScore(left) ? right : left;
}

function imageScore(url: string): number {
  const explicit = url.match(/(?:^|[^0-9])(200|400|600|800|1000|1200|1600)(?:[^0-9]|$)/)?.[1];
  return explicit ? Number(explicit) : url.includes("/large") || url.includes("_hires") ? 900 : 500;
}

function latestIso(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}
