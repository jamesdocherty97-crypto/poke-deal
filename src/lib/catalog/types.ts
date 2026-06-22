import type { CardRef, Currency, Game, Language } from "../domain/types.js";

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
}

export interface CatalogCard {
  game: Game;
  language: Language;
  name: string;
  setName: string;
  setCode?: string;
  number?: string;
  rarity?: string;
  imageUrl?: string;
  setLogoUrl?: string;
  setSymbolUrl?: string;
  tcgApiId?: string;
  priceSignals?: CatalogPriceSignal[];
}

export interface CatalogSource {
  readonly name: string;
  readonly live: boolean;
  resolve(card: CardRef): Promise<CatalogCard | null>;
}
