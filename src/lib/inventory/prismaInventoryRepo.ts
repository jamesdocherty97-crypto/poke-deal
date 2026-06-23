import type { Grade } from "../domain/types.js";
import { getPrisma } from "../db/prisma.js";
import { PokemonTcgApiCatalogSource } from "../catalog/pokemonTcgApi.js";
import {
  PrismaCardCache,
  toCardRef,
  type PrismaCard,
  type PrismaCardDb,
} from "../catalog/prismaCardCache.js";
import type { CatalogSource } from "../catalog/types.js";
import type {
  InventoryItemDraft,
  InventoryItemRecord,
  InventoryRepo,
} from "./inventoryService.js";

type DbInventoryItem = {
  id: string;
  card: PrismaCard;
  grade: Grade;
  quantity: number;
  costBasis: number;
  acquiredFrom: string | null;
  location: string | null;
  condition: string | null;
  graderCert: string | null;
  status: InventoryItemDraft["status"];
  createdAt: Date;
};

type InventoryDb = PrismaCardDb & {
  inventoryItem: {
    create(args: {
      data: {
        cardId: string;
        grade: Grade;
        quantity: number;
        costBasis: number;
        acquiredFrom?: string;
        location?: string;
        condition?: string;
        graderCert?: string;
        status: InventoryItemDraft["status"];
      };
      include: { card: true };
    }): Promise<DbInventoryItem>;
    findMany(args: {
      include: { card: true };
      orderBy: { createdAt: "desc" };
    }): Promise<DbInventoryItem[]>;
  };
};

export class PrismaInventoryRepo implements InventoryRepo {
  private readonly db: InventoryDb;
  private readonly cardCache: PrismaCardCache;

  constructor(db?: InventoryDb, catalog?: CatalogSource | null) {
    this.db = db ?? (getPrisma() as unknown as InventoryDb);
    const catalogSource = catalog === undefined && !db ? new PokemonTcgApiCatalogSource() : catalog ?? null;
    this.cardCache = new PrismaCardCache(this.db, catalogSource);
  }

  async create(draft: InventoryItemDraft): Promise<InventoryItemRecord> {
    const card = await this.cardCache.resolve(draft.card);
    const item = await this.db.inventoryItem.create({
      data: {
        cardId: card.id,
        grade: draft.grade,
        quantity: draft.quantity,
        costBasis: draft.costBasisPence,
        acquiredFrom: draft.acquiredFrom,
        location: draft.location,
        condition: draft.condition,
        graderCert: draft.graderCert,
        status: draft.status,
      },
      include: { card: true },
    });

    return toInventoryRecord(item);
  }

  async list(): Promise<InventoryItemRecord[]> {
    const items = await this.db.inventoryItem.findMany({
      include: { card: true },
      orderBy: { createdAt: "desc" },
    });
    return items.map(toInventoryRecord);
  }
}

function toInventoryRecord(item: DbInventoryItem): InventoryItemRecord {
  return {
    id: item.id,
    card: toCardRef(item.card),
    grade: item.grade,
    quantity: item.quantity,
    costBasisPence: item.costBasis,
    acquiredFrom: item.acquiredFrom ?? undefined,
    location: item.location ?? undefined,
    condition: item.condition ?? undefined,
    graderCert: item.graderCert ?? undefined,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
  };
}
