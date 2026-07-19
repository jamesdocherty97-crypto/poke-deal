import type { CardRef, CompQuery, CompResult, Grade, RawCondition } from "../../domain/types.js";
import { normalizeCollectorNumberForCompare } from "../../cards/identity.js";
import type { CompSource } from "../CompSource.js";
import { DEFAULT_WINDOW_DAYS } from "../cleaning.js";
import { mean, median } from "../cleaning.js";
import { saleItemSubtotalPence, type SaleChannel } from "../../dealer/saleFees.js";
import { normalizeRawCondition } from "../pricing.js";

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
  channel: SaleChannel;
  salePrice: number;
  fees: number;
  postage: number;
  soldAt: Date;
  item: {
    id: string;
    grade: Grade;
    condition: string | null;
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
  condition?: RawCondition;
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
    const ctx = { source: this.name, card, grade, condition: query.condition, windowDays };

    if (grade === "RAW" && !query.condition) {
      return emptyOwnedSalesComp(ctx, "RAW owned sales need an exact condition bucket");
    }

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
    .filter((row) => ctx.grade !== "RAW" || Boolean(ctx.condition && normalizeRawCondition(row.item.condition) === ctx.condition))
    .filter((row) => row.salePrice > 0)
    .sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime());

  if (matching.length === 0) {
    return emptyOwnedSalesComp(ctx, "no matching owned sales");
  }

  const prices = matching.map(ownedSaleCompPricePence);
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
      caveat: "Your own sold prices for this exact card, grade and RAW condition.",
      condition: ctx.grade === "RAW" ? ctx.condition : undefined,
      conditionMatched: true,
      sales: matching.map((row) => ({
        id: row.id,
        itemId: row.item.id,
        salePricePence: row.salePrice,
        itemSubtotalPence: ownedSaleCompPricePence(row),
        feesPence: row.fees,
        postagePence: row.postage,
        costBasisPence: row.item.costBasis,
        soldAt: row.soldAt.toISOString(),
      })),
    },
  };
}

function ownedSaleCompPricePence(row: OwnedSaleRow): number {
  return saleItemSubtotalPence(row.channel, row.salePrice, { grade: row.item.grade });
}

export function buildOwnedSalesWhere(card: CardRef, grade: Grade, windowDays: number): unknown {
  const soldAfter = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const cardWhere =
    card.tcgApiId
      ? { tcgApiId: card.tcgApiId }
      : ownedSalesCardWhere(card);

  return {
    soldAt: { gte: soldAfter },
    item: {
      grade,
      card: cardWhere,
    },
  };
}

function ownedSalesCardWhere(card: CardRef): unknown {
  const base = {
    game: card.game ?? "POKEMON",
    language: card.language ?? "EN",
    name: card.name,
    ...(card.setName ? { setName: card.setName } : {}),
  };
  if (!card.number) return base;
  const comparableNumber = normalizeCollectorNumberForCompare(card.number);
  if (!comparableNumber || comparableNumber === card.number.trim()) return { ...base, number: card.number };
  return { ...base, OR: [{ number: card.number }, { number: comparableNumber }] };
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
    raw: {
      kind: "owned-sales",
      reason,
      condition: ctx.grade === "RAW" ? ctx.condition : undefined,
      conditionMatched: false,
    },
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
  const older = rows.slice(0, mid).map(ownedSaleCompPricePence);
  const recent = rows.slice(mid).map(ownedSaleCompPricePence);
  const olderMedian = median(older);
  const recentMedian = median(recent);
  if (olderMedian <= 0) return null;
  return Math.round(((recentMedian - olderMedian) / olderMedian) * 1000) / 10;
}
