import type { Prisma } from "@prisma/client";
import type { CompQuery, CompResult, Grade, RawCondition } from "../domain/types.js";
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
  condition?: string | null;
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
  condition?: RawCondition;
}

type CompResultDb = PrismaCardDb & {
  compResult: {
    create(args: {
      data: {
        cardId: string;
        grade: Grade;
        condition?: RawCondition;
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
        condition: RawCondition | null;
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
  condition?: RawCondition;
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
    const receipt = persistedReceipt(audit.receipt, reconciliation);
    const row = await this.db.compResult.create({
      data: {
        cardId: card.id,
        grade: comp.grade,
        ...(audit.condition ? { condition: audit.condition } : {}),
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
        ...(receipt === undefined ? {} : { receipt: toJsonValue(receipt) }),
      },
    });

    return {
      id: row.id,
      cardId: row.cardId,
      grade: row.grade,
      condition: normalizePersistedCondition(row.condition),
      source: row.source,
      medianPence: row.medianPence,
      sampleSize: row.sampleSize,
      asOf: row.asOf.toISOString(),
      createdAt: row.createdAt.toISOString(),
      confidence: row.confidence ?? undefined,
      manualCheck: row.manualCheck ?? false,
    };
  }

  async findLatest(cardRef: CompResult["card"], grade: Grade, condition?: RawCondition): Promise<CompResult | null> {
    return (await this.findLatestRecord(cardRef, grade, condition))?.headline ?? null;
  }

  async findLatestRecord(
    cardRef: CompResult["card"],
    grade: Grade,
    condition?: RawCondition,
  ): Promise<CachedCompRecord | null> {
    const card = await this.cardCache.resolve(cardRef);
    const row = await this.db.compResult.findFirst({
      where: { cardId: card.id, grade, condition: condition ?? null },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    const headline: CompResult = {
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
        condition: normalizePersistedCondition(row.condition),
      },
    };
    return {
      headline,
      reconciliation: persistedReconciliation(row),
      sourcesDisagree: persistedSourcesDisagree(row),
      cachedAt: row.createdAt.toISOString(),
    };
  }
}

export class PrismaLastKnownCompCache implements LastKnownCompCache {
  constructor(private readonly repo = new PrismaCompResultRepo()) {}

  async get(card: CompResult["card"], query: CompQuery): Promise<CachedCompRecord | null> {
    return this.repo.findLatestRecord(card, query.grade ?? "RAW", query.condition);
  }
}

function normalizePersistedCondition(value: string | null | undefined): RawCondition | undefined {
  return ["NM", "LP", "MP", "HP", "DMG"].includes(value ?? "") ? value as RawCondition : undefined;
}

function parseDate(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function persistedReceipt(receipt: unknown, reconciliation: ReconResult | undefined): unknown {
  if (!reconciliation) return receipt;
  if (isRecord(receipt)) return { ...receipt, reconciliation };
  if (receipt === undefined) return { reconciliation };
  return { evidence: receipt, reconciliation };
}

function persistedReconciliation(row: DbCompResult): ReconResult | undefined {
  const exact = parseReconciliation(isRecord(row.receipt) ? row.receipt.reconciliation : undefined);
  if (exact) return exact;
  if (!isReconConfidence(row.confidence) || typeof row.manualCheck !== "boolean") return undefined;
  return {
    headlinePence: row.medianPence > 0 ? row.medianPence : null,
    confidence: row.confidence,
    manualCheck: row.manualCheck,
    reasons: Array.isArray(row.reasons)
      ? row.reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
    trendPct: row.trendPct,
  };
}

function persistedSourcesDisagree(row: DbCompResult): boolean | undefined {
  const receipt = isRecord(row.receipt) ? row.receipt : undefined;
  return typeof receipt?.sourcesDisagree === "boolean" ? receipt.sourcesDisagree : undefined;
}

function parseReconciliation(value: unknown): ReconResult | undefined {
  if (!isRecord(value)) return undefined;
  if (!isReconConfidence(value.confidence) || typeof value.manualCheck !== "boolean") return undefined;
  if (!Array.isArray(value.reasons) || !value.reasons.every((reason) => typeof reason === "string")) return undefined;
  if (value.headlinePence !== null && typeof value.headlinePence !== "number") return undefined;
  if (value.trendPct !== null && typeof value.trendPct !== "number") return undefined;
  return value as unknown as ReconResult;
}

function isReconConfidence(value: unknown): value is ReconResult["confidence"] {
  return value === "high" || value === "medium" || value === "low";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
