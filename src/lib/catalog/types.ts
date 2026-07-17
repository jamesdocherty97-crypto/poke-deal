import type { CardFinish, CardRef, Currency, Game, Language, PrintEdition } from "../domain/types.js";
import type { FxRateInfo } from "../comps/currency.js";

export interface CatalogPriceSignal {
  source: "tcgplayer" | "cardmarket";
  label: string;
  pricePence: number;
  originalAmount: number;
  originalCurrency: Exclude<Currency, "GBP" | "JPY">;
  kind: string;
  variant?: string;
  updatedAt?: string;
  url?: string;
  fx?: FxRateInfo;
}

export interface CatalogCard {
  game: Game;
  language: Language;
  name: string;
  setName: string;
  setCode?: string;
  number?: string;
  rarity?: string;
  /** Listing-safe catalog art returned by Pokemon TCG API or TCGdex. */
  imageUrl?: string;
  /** Display-only fallback art, usually provider CDN. Must never feed listing photos. */
  displayImageUrl?: string;
  setLogoUrl?: string;
  setSymbolUrl?: string;
  tcgApiId?: string;
  tcgDexId?: string;
  cardmarketId?: string;
  edition?: PrintEdition;
  finish?: CardFinish;
  /** Where this particular read came from; avoids presenting persisted rows as live provider reads. */
  provenance?: {
    origin: "live" | "cache" | "curated" | "fixture";
    providers: string[];
    retrievedAt?: string;
    cachedAt?: string;
    expiresAt?: string;
  };
  priceSignals?: CatalogPriceSignal[];
}

export interface CatalogSource {
  readonly name: string;
  readonly live: boolean;
  resolve(card: CardRef, context?: CatalogSourceContext): Promise<CatalogCard | null>;
  search?(card: CardRef, limit?: number, context?: CatalogSourceContext): Promise<CatalogCard[]>;
}

export interface CatalogSourceContext {
  signal?: AbortSignal;
}
