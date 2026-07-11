import type { Prisma } from "@prisma/client";
import type { CompResult, Grade } from "../domain/types.js";
import { getPrisma } from "../db/prisma.js";
import { PokemonTcgApiCatalogSource } from "../catalog/pokemonTcgApi.js";
import {
  PrismaCardCache,
  type PrismaCardDb,
} from "../catalog/prismaCardCache.js";
import type { CatalogSource } from "../catalog/types.js";
import type { CachedCompRecord, LastKnownCompCache } from "./compService.js";
import type { ReconResult } from "./reconciler.js";

type DbCompResult = {
  id: string;
  cardId: string;
  grade: Grade;
  source: string;
  currency: string;
  medianPence: number;
  meanPence: number;
  lowPence: number;
  highPence: number;
  sampleSize: number;
  windowDays: number;
  trendPct: number | null;
  outliersRemoved: number;
  asOf: Date;
  createdAt: Date;
  confidence?: string | null;
  manualCheck?: boolean;
  reasons?: unknown;
  receipt?: unknown;
};

export interface CompResultAuditData {
  reconciliation?: ReconResult;
  receipt?: unknown;
}

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
        confidence?: string;
        manualCheck?: boolean;
        reasons?: Prisma.InputJsonValue;
        receipt?: Prisma.InputJsonValue;
      };
    }): Promise<DbCompResult>;
    findFirst(args: {
      where: {
        cardId: string;
        grade: Grade;
      };
      orderBy: {
        createdAt: "desc";
      };
    }): Promise<DbCompResult | null>;
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
  confidence?: string;
  manualCheck: boolean;
}

export class PrismaCompResultRepo {
  private readonly db: CompResultDb;
  private readonly cardCache: PrismaCardCache;

  constructor(db?: CompResultDb, catalog?: CatalogSource | null) {
    this.db = db ?? (getPrisma() as unknown as CompResultDb);
    const catalogSource = catalog === undefined && !db ? new PokemonTcgApiCatalogSource() : catalog ?? null;
    this.cardCache = new PrismaCardCache(this.db, catalogSource);
  }

  async create(comp: CompResult, audit: CompResultAuditData = {}): Promise<PersistedCompResultRecord> {
    const card = await this.cardCache.resolve(comp.card);
    const reconciliation = audit.reconciliation;
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
        ...(reconciliation
          ? {
              confidence: reconciliation.confidence,
              manualCheck: reconciliation.manualCheck,
              reasons: toJsonValue(reconciliation.reasons),
            }
          : {}),
        ...(audit.receipt === undefined ? {} : { receipt: toJsonValue(audit.receipt) }),
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
      confidence: row.confidence ?? undefined,
      manualCheck: row.manualCheck ?? false,
    };
  }

  async findLatest(cardRef: CompResult["card"], grade: Grade): Promise<CompResult | null> {
    const card = await this.cardCache.resolve(cardRef);
    const row = await this.db.compResult.findFirst({
      where: { cardId: card.id, grade },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    return {
      source: row.source,
      card: {
        id: card.id,
        name: card.name,
        setName: card.setName,
        number: card.number ?? undefined,
        tcgApiId: card.tcgApiId ?? undefined,
        game: card.game,
        language: card.language,
      },
      grade: row.grade,
      currency: "GBP",
      medianPence: row.medianPence,
      meanPence: row.meanPence,
      lowPence: row.lowPence,
      highPence: row.highPence,
      sampleSize: row.sampleSize,
      windowDays: row.windowDays,
      trendPct: row.trendPct,
      outliersRemoved: row.outliersRemoved,
      asOf: row.asOf.toISOString(),
      raw: {
        kind: "last-known-comp",
        cachedAt: row.createdAt.toISOString(),
      },
    };
  }
}

export class PrismaLastKnownCompCache implements LastKnownCompCache {
  constructor(private readonly repo = new PrismaCompResultRepo()) {}

  async get(card: CompResult["card"], query: { grade?: Grade }): Promise<CachedCompRecord | null> {
    const headline = await this.repo.findLatest(card, query.grade ?? "RAW");
    if (!headline) return null;
    const cachedAt =
      headline.raw && typeof headline.raw === "object" && "cachedAt" in headline.raw && typeof headline.raw.cachedAt === "string"
        ? headline.raw.cachedAt
        : headline.asOf;
    return { headline, cachedAt };
  }
}

function parseDate(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
