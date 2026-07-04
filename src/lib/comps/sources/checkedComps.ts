import { PrismaCardCache, toCardRef, type PrismaCardDb, type PrismaCard } from "../../catalog/prismaCardCache.js";
import type { CatalogSource } from "../../catalog/types.js";
import type { CardRef, CompQuery, CompResult, Grade } from "../../domain/types.js";
import type { CompSource } from "../CompSource.js";
import { mean, median } from "../cleaning.js";

export type CheckedCompPlatform = "ebay-uk" | "cardmarket" | "vinted" | "other";

type CheckedCompCard = PrismaCard & {
  cardmarketId?: string | null;
};

export type CheckedCompRow = {
  id: string;
  cardId: string;
  grade: Grade;
  pricePence: number;
  soldDate: Date;
  platform: string;
  note: string | null;
  sourceUrl: string | null;
  createdAt: Date;
  card: CheckedCompCard;
};

export type CreateCheckedCompInput = {
  card: CardRef;
  grade: Grade;
  pricePence: number;
  soldDate?: Date;
  platform?: CheckedCompPlatform;
  note?: string;
  sourceUrl?: string;
};

export type CheckedCompDb = PrismaCardDb & {
  checkedComp: {
    create(args: {
      data: {
        cardId: string;
        grade: Grade;
        pricePence: number;
        soldDate: Date;
        platform: CheckedCompPlatform;
        note?: string;
        sourceUrl?: string;
      };
      include: { card: true };
    }): Promise<CheckedCompRow>;
    findMany(args: {
      where: unknown;
      include: { card: true };
      orderBy: { soldDate: "desc" };
      take: number;
    }): Promise<CheckedCompRow[]>;
  };
};

type CheckedCompsContext = {
  source: string;
  card: CardRef;
  grade: Grade;
  windowDays: number;
};

const SOURCE_NAME = "checked-comps";
const DEFAULT_CHECKED_COMP_WINDOW_DAYS = 90;
const MAX_CHECKED_COMPS = 50;

export class PrismaCheckedCompRepo {
  private readonly cardCache: PrismaCardCache;

  constructor(
    private readonly db: CheckedCompDb,
    catalog: CatalogSource | null = null,
  ) {
    this.cardCache = new PrismaCardCache(db, catalog);
  }

  async create(input: CreateCheckedCompInput): Promise<CheckedCompRow> {
    const pricePence = Math.round(input.pricePence);
    if (!Number.isFinite(pricePence) || pricePence <= 0) throw new Error("Checked comp price must be positive.");
    const card = await this.cardCache.resolve(input.card);
    return this.db.checkedComp.create({
      data: {
        cardId: card.id,
        grade: input.grade,
        pricePence,
        soldDate: input.soldDate ?? new Date(),
        platform: normalizeCheckedCompPlatform(input.platform),
        ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
        ...(cleanOptional(input.sourceUrl) ? { sourceUrl: cleanOptional(input.sourceUrl) } : {}),
      },
      include: { card: true },
    });
  }

  async list(card: CardRef, grade: Grade, windowDays = DEFAULT_CHECKED_COMP_WINDOW_DAYS): Promise<CheckedCompRow[]> {
    return this.db.checkedComp.findMany({
      where: buildCheckedCompsWhere(card, grade, windowDays),
      include: { card: true },
      orderBy: { soldDate: "desc" },
      take: MAX_CHECKED_COMPS,
    });
  }
}

export class CheckedCompsSource implements CompSource {
  readonly name = SOURCE_NAME;
  readonly live = true;

  constructor(private readonly db: CheckedCompDb) {}

  async lookup(card: CardRef, query: CompQuery = {}): Promise<CompResult> {
    const grade: Grade = query.grade ?? "RAW";
    const windowDays = DEFAULT_CHECKED_COMP_WINDOW_DAYS;
    const ctx = { source: this.name, card, grade, windowDays };

    try {
      const rows = await this.db.checkedComp.findMany({
        where: buildCheckedCompsWhere(card, grade, windowDays),
        include: { card: true },
        orderBy: { soldDate: "desc" },
        take: MAX_CHECKED_COMPS,
      });
      return mapCheckedCompsToComp(rows, ctx);
    } catch {
      return emptyCheckedCompsComp(ctx, "checked comp lookup failed");
    }
  }
}

export function mapCheckedCompsToComp(rows: CheckedCompRow[], ctx: CheckedCompsContext): CompResult {
  const cutoff = Date.now() - ctx.windowDays * 24 * 60 * 60 * 1000;
  const matching = rows
    .filter((row) => row.grade === ctx.grade)
    .filter((row) => row.pricePence > 0)
    .filter((row) => row.soldDate.getTime() >= cutoff)
    .sort((a, b) => a.soldDate.getTime() - b.soldDate.getTime());

  if (matching.length === 0) {
    return emptyCheckedCompsComp(ctx, "no matching checked comps");
  }

  const prices = matching.map((row) => row.pricePence);
  const latest = matching[matching.length - 1]!;
  const med = Math.round(median(prices));

  return {
    source: ctx.source,
    card: toCardRef(latest.card),
    grade: ctx.grade,
    currency: "GBP",
    medianPence: med,
    meanPence: Math.round(mean(prices)),
    lowPence: Math.min(...prices),
    highPence: Math.max(...prices),
    sampleSize: matching.length,
    windowDays: ctx.windowDays,
    trendPct: null,
    outliersRemoved: 0,
    asOf: latest.soldDate.toISOString(),
    raw: {
      kind: "checked-comps",
      caveat: "Dealer-logged sold prices for this exact card and grade.",
      region: aggregateRegion(matching),
      entries: matching.map(checkedCompRowForRaw),
    },
  };
}

export function checkedCompRowForRaw(row: CheckedCompRow) {
  return {
    id: row.id,
    cardId: row.cardId,
    grade: row.grade,
    pricePence: row.pricePence,
    soldDate: row.soldDate.toISOString(),
    platform: normalizeCheckedCompPlatform(row.platform),
    note: row.note ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export function buildCheckedCompsWhere(card: CardRef, grade: Grade, windowDays: number): unknown {
  const soldAfter = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  return {
    grade,
    soldDate: { gte: soldAfter },
    card: cardLookupWhere(card),
  };
}

export function normalizeCheckedCompPlatform(platform: string | undefined): CheckedCompPlatform {
  if (platform === "cardmarket" || platform === "vinted" || platform === "other") return platform;
  return "ebay-uk";
}

export function checkedCompPlatformRegion(platform: string | undefined): "UK" | "EU" {
  return normalizeCheckedCompPlatform(platform) === "cardmarket" ? "EU" : "UK";
}

function aggregateRegion(rows: CheckedCompRow[]): "UK" | "EU" {
  const euCount = rows.filter((row) => checkedCompPlatformRegion(row.platform) === "EU").length;
  return euCount > rows.length / 2 ? "EU" : "UK";
}

function cardLookupWhere(card: CardRef): unknown {
  if (card.id) return { id: card.id };
  if (card.tcgApiId) return { tcgApiId: card.tcgApiId };
  if (card.tcgDexId) return { tcgDexId: card.tcgDexId };
  return {
    game: card.game ?? "POKEMON",
    language: card.language ?? "EN",
    name: card.name,
    ...(card.setName ? { setName: card.setName } : {}),
    ...(card.number ? { number: card.number } : {}),
  };
}

function emptyCheckedCompsComp(ctx: CheckedCompsContext, reason: string): CompResult {
  return {
    source: ctx.source,
    card: ctx.card,
    grade: ctx.grade,
    currency: "GBP",
    medianPence: 0,
    meanPence: 0,
    lowPence: 0,
    highPence: 0,
    sampleSize: 0,
    windowDays: ctx.windowDays,
    trendPct: null,
    outliersRemoved: 0,
    asOf: new Date().toISOString(),
    raw: { kind: "checked-comps", reason },
  };
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
