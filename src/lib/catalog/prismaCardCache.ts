import type { CardRef, Game, Language } from "../domain/types.js";
import type { CatalogCard, CatalogSource } from "./types.js";

export type PrismaCard = {
  id: string;
  game: Game;
  language: Language;
  name: string;
  setName: string;
  setCode: string | null;
  number: string | null;
  rarity: string | null;
  imageUrl: string | null;
  displayImageUrl: string | null;
  tcgApiId: string | null;
  tcgDexId?: string | null;
};

export type PrismaCardData = {
  game: Game;
  language: Language;
  name: string;
  setName: string;
  setCode?: string;
  number?: string;
  rarity?: string;
  imageUrl?: string;
  displayImageUrl?: string;
  tcgApiId?: string;
  tcgDexId?: string;
};

export type PrismaCardDb = {
  card: {
    findUnique(args: any): Promise<PrismaCard | null>;
    findFirst(args: { where: Partial<PrismaCardData> }): Promise<PrismaCard | null>;
    create(args: { data: PrismaCardData }): Promise<PrismaCard>;
    upsert(args: any): Promise<PrismaCard>;
  };
};

const UNKNOWN_SET_NAME = "Unknown";

export class PrismaCardCache {
  constructor(
    private readonly db: PrismaCardDb,
    private readonly catalog: CatalogSource | null,
  ) {}

  async resolve(card: CardRef | CatalogCard): Promise<PrismaCard> {
    if ("id" in card && card.id) {
      const existing = await this.db.card.findUnique({ where: { id: card.id } });
      if (!existing) throw new Error(`Card not found: ${card.id}`);
      return existing;
    }

    const fallbackData = toCardData(card);
    if (!fallbackData.tcgApiId) {
      const cached = await this.findCachedCard(fallbackData);
      if (cached) return cached;
    }

    const catalogCard = await this.resolveFromCatalog(card);
    const data = catalogCard ? toCardData(catalogCard) : fallbackData;
    if (data.tcgApiId) {
      return this.db.card.upsert({
        where: { tcgApiId: data.tcgApiId },
        create: data,
        update: data,
      });
    }
    if (data.tcgDexId) {
      return this.db.card.upsert({
        where: { tcgDexId: data.tcgDexId },
        create: data,
        update: data,
      });
    }

    const existing = await this.db.card.findFirst({ where: cardLookupWhere(data) });
    return existing ?? this.db.card.create({ data });
  }

  private async findCachedCard(data: PrismaCardData): Promise<PrismaCard | null> {
    if (data.tcgApiId) {
      const existing = await this.db.card.findUnique({ where: { tcgApiId: data.tcgApiId } });
      if (existing) return existing;
    }
    if (data.tcgDexId) {
      const existing = await this.db.card.findUnique({ where: { tcgDexId: data.tcgDexId } });
      if (existing) return existing;
    }

    return this.db.card.findFirst({ where: cardLookupWhere(data) });
  }

  private async resolveFromCatalog(card: CardRef | CatalogCard): Promise<CatalogCard | null> {
    if (!this.catalog) return null;
    try {
      return await this.catalog.resolve(card);
    } catch {
      return null;
    }
  }
}

export function toCardRef(card: PrismaCard): CardRef {
  return {
    id: card.id,
    game: card.game,
    language: card.language,
    name: card.name,
    setName: card.setName,
    number: card.number ?? undefined,
    tcgApiId: card.tcgApiId ?? undefined,
    tcgDexId: card.tcgDexId ?? undefined,
  };
}

export function toCardData(card: CardRef | CatalogCard): PrismaCardData {
  const name = card.name.trim();
  if (!name) throw new Error("Card name is required");

  const setName = card.setName?.trim() || UNKNOWN_SET_NAME;
  return {
    game: card.game ?? "POKEMON",
    language: card.language ?? "EN",
    name,
    setName,
    setCode: cleanOptional("setCode" in card ? card.setCode : undefined),
    number: cleanOptional(card.number),
    rarity: cleanOptional("rarity" in card ? card.rarity : undefined),
    imageUrl: cleanOptional("imageUrl" in card ? card.imageUrl : undefined),
    displayImageUrl: cleanOptional("displayImageUrl" in card ? card.displayImageUrl : undefined),
    tcgApiId: cleanOptional(card.tcgApiId),
    tcgDexId: cleanOptional("tcgDexId" in card ? card.tcgDexId : undefined),
  };
}

function cardLookupWhere(data: PrismaCardData): Partial<PrismaCardData> {
  return dropUndefined({
    game: data.game,
    language: data.language,
    name: data.name,
    setName: data.setName,
    number: data.number,
  });
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function dropUndefined<T extends Record<string, unknown>>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<T>;
}
