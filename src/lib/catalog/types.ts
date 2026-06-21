import type { CardRef, Game, Language } from "../domain/types.js";

export interface CatalogCard {
  game: Game;
  language: Language;
  name: string;
  setName: string;
  setCode?: string;
  number?: string;
  rarity?: string;
  imageUrl?: string;
  tcgApiId?: string;
}

export interface CatalogSource {
  readonly name: string;
  readonly live: boolean;
  resolve(card: CardRef): Promise<CatalogCard | null>;
}
