import type { CompResult, Grade } from "../domain/types.js";
import { getPrisma } from "../db/prisma.js";
import { PokemonTcgApiCatalogSource } from "../catalog/pokemonTcgApi.js";
import {
  PrismaCardCache,
  type PrismaCardDb,
} from "../catalog/prismaCardCache.js";
import type { CatalogSource } from "../catalog/types.js";

type DbCompResult = {
  id: string;
  cardId: string;
  grade: Grade;
  source: string;
  medianPence: number;
  sampleSize: number;
  asOf: Date;
  createdAt: Date;
};

type CompResultDb = PrismaCardDb & {
  compResult: {
    create(args: {
      data: {
        cardId: string;
        grade: Grade;
        source: string;
        currency: "GBP";
        medianPence: number;
        meanPence: number;
        lowPence: number;
        highPence: number;
        sampleSize: number;
        windowDays: number;
        trendPct: number | null;
        outliersRemoved: number;
        asOf: Date;
      };
    }): Promise<DbCompResult>;
  };
};

export interface PersistedCompResultRecord {
  id: string;
  cardId: string;
  grade: Grade;
  source: string;
  medianPence: number;
  sampleSize: number;
  asOf: string;
  createdAt: string;
}

export class PrismaCompResultRepo {
  private readonly db: CompResultDb;
  private readonly cardCache: PrismaCardCache;

  constructor(db?: CompResultDb, catalog?: CatalogSource | null) {
    this.db = db ?? (getPrisma() as unknown as CompResultDb);
    const catalogSource = catalog === undefined && !db ? new PokemonTcgApiCatalogSource() : catalog ?? null;
    this.cardCache = new PrismaCardCache(this.db, catalogSource);
  }

  async create(comp: CompResult): Promise<PersistedCompResultRecord> {
    const card = await this.cardCache.resolve(comp.card);
    const row = await this.db.compResult.create({
      data: {
        cardId: card.id,
        grade: comp.grade,
        source: comp.source,
        currency: comp.currency,
        medianPence: comp.medianPence,
        meanPence: comp.meanPence,
        lowPence: comp.lowPence,
        highPence: comp.highPence,
        sampleSize: comp.sampleSize,
        windowDays: comp.windowDays,
        trendPct: comp.trendPct,
        outliersRemoved: comp.outliersRemoved,
        asOf: parseDate(comp.asOf),
      },
    });

    return {
      id: row.id,
      cardId: row.cardId,
      grade: row.grade,
      source: row.source,
      medianPence: row.medianPence,
      sampleSize: row.sampleSize,
      asOf: row.asOf.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function parseDate(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
