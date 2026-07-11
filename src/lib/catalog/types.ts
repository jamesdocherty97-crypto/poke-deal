import type { CardRef, Currency, Game, Language } from "../domain/types.js";
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
  /** Listing-safe catalog art from Pokemon TCG API/ScryDex/TCGdex. */
  imageUrl?: string;
  /** Display-only fallback art, usually provider CDN. Must never feed listing photos. */
  displayImageUrl?: string;
  setLogoUrl?: string;
  setSymbolUrl?: string;
  tcgApiId?: string;
  tcgDexId?: string;
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
