import type { CardRef, CompQuery, CompResult, Grade } from "../../domain/types.js";
import type { CompSource } from "../CompSource.js";
import { DEFAULT_WINDOW_DAYS } from "../cleaning.js";
import { mean, median } from "../cleaning.js";

type OwnedSaleCard = {
  id: string;
  game: string;
  language: string;
  name: string;
  setName: string;
  setCode: string | null;
  number: string | null;
  tcgApiId: string | null;
};

export type OwnedSaleRow = {
  id: string;
  salePrice: number;
  fees: number;
  postage: number;
  soldAt: Date;
  item: {
    id: string;
    grade: Grade;
    costBasis: number;
    card: OwnedSaleCard;
  };
};

export type OwnedSalesDb = {
  sale: {
    findMany(args: {
      where: unknown;
      include: { item: { include: { card: true } } };
      orderBy: { soldAt: "desc" };
      take: number;
    }): Promise<OwnedSaleRow[]>;
  };
};

type OwnedSalesContext = {
  source: string;
  card: CardRef;
  grade: Grade;
  windowDays: number;
};

const SOURCE_NAME = "owned-sales";
const MAX_OWNED_SALES = 25;

export class OwnedSalesSource implements CompSource {
  readonly name = SOURCE_NAME;
  readonly live = true;

  constructor(private readonly db: OwnedSalesDb) {}

  async lookup(card: CardRef, query: CompQuery = {}): Promise<CompResult> {
    const grade: Grade = query.grade ?? "RAW";
    const windowDays = query.windowDays ?? DEFAULT_WINDOW_DAYS;
    const ctx = { source: this.name, card, grade, windowDays };

    try {
      const sales = await this.db.sale.findMany({
        where: buildOwnedSalesWhere(card, grade, windowDays),
        include: { item: { include: { card: true } } },
        orderBy: { soldAt: "desc" },
        take: MAX_OWNED_SALES,
      });
      return mapOwnedSalesToComp(sales, ctx);
    } catch {
      return emptyOwnedSalesComp(ctx, "owned sale lookup failed");
    }
  }
}

export function mapOwnedSalesToComp(rows: OwnedSaleRow[], ctx: OwnedSalesContext): CompResult {
  const matching = rows
    .filter((row) => row.item.grade === ctx.grade)
    .filter((row) => row.salePrice > 0)
    .sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime());

  if (matching.length === 0) {
    return emptyOwnedSalesComp(ctx, "no matching owned sales");
  }

  const prices = matching.map((row) => row.salePrice);
  const card = rowToCardRef(matching[matching.length - 1]!, ctx.card);

  return {
    source: ctx.source,
    card,
    grade: ctx.grade,
    currency: "GBP",
    medianPence: Math.round(median(prices)),
    meanPence: Math.round(mean(prices)),
    lowPence: Math.min(...prices),
    highPence: Math.max(...prices),
    sampleSize: matching.length,
    windowDays: ctx.windowDays,
    trendPct: computeOwnedSalesTrend(matching),
    outliersRemoved: 0,
    asOf: matching[matching.length - 1]!.soldAt.toISOString(),
    raw: {
      kind: "owned-sales",
      caveat: "Your own sold prices for this exact card and grade.",
      sales: matching.map((row) => ({
        id: row.id,
        itemId: row.item.id,
        salePricePence: row.salePrice,
        feesPence: row.fees,
        postagePence: row.postage,
        costBasisPence: row.item.costBasis,
        soldAt: row.soldAt.toISOString(),
      })),
    },
  };
}

export function buildOwnedSalesWhere(card: CardRef, grade: Grade, windowDays: number): unknown {
  const soldAfter = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const cardWhere =
    card.tcgApiId
      ? { tcgApiId: card.tcgApiId }
      : {
          game: card.game ?? "POKEMON",
          language: card.language ?? "EN",
          name: card.name,
          ...(card.setName ? { setName: card.setName } : {}),
          ...(card.number ? { number: card.number } : {}),
        };

  return {
    soldAt: { gte: soldAfter },
    item: {
      grade,
      card: cardWhere,
    },
  };
}

function emptyOwnedSalesComp(ctx: OwnedSalesContext, reason: string): CompResult {
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
    raw: { kind: "owned-sales", reason },
  };
}

function rowToCardRef(row: OwnedSaleRow, fallback: CardRef): CardRef {
  const card = row.item.card;
  return {
    ...fallback,
    id: card.id,
    name: card.name,
    setName: card.setName,
    number: card.number ?? fallback.number,
    tcgApiId: card.tcgApiId ?? fallback.tcgApiId,
    game: card.game === "SOCCER" ? "SOCCER" : "POKEMON",
    language: card.language === "JP" ? "JP" : "EN",
  };
}

function computeOwnedSalesTrend(rows: OwnedSaleRow[]): number | null {
  if (rows.length < 4) return null;
  const mid = Math.floor(rows.length / 2);
  const older = rows.slice(0, mid).map((row) => row.salePrice);
  const recent = rows.slice(mid).map((row) => row.salePrice);
  const olderMedian = median(older);
  const recentMedian = median(recent);
  if (olderMedian <= 0) return null;
  return Math.round(((recentMedian - olderMedian) / olderMedian) * 1000) / 10;
}
