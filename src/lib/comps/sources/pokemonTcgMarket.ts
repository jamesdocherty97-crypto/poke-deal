import type { CatalogCard, CatalogPriceSignal, CatalogSource } from "../../catalog/types.js";
import { PokemonTcgApiCatalogSource, pickCatalogPriceSignal } from "../../catalog/pokemonTcgApi.js";
import type { CardRef, CompQuery, CompResult, Grade } from "../../domain/types.js";
import type { CompSource } from "../CompSource.js";
import { DEFAULT_WINDOW_DAYS } from "../cleaning.js";

const MARKET_WINDOW_DAYS = 30;

type MarketContext = {
  source: string;
  card: CardRef;
  grade: Grade;
  windowDays: number;
};

export class PokemonTcgMarketSource implements CompSource {
  readonly name = "pokemon-tcg-market";
  readonly live: boolean;

  constructor(private readonly catalog: CatalogSource = new PokemonTcgApiCatalogSource()) {
    this.live = catalog.live;
  }

  async lookup(card: CardRef, query: CompQuery = {}): Promise<CompResult> {
    const grade: Grade = query.grade ?? "RAW";
    const ctx = {
      source: this.name,
      card,
      grade,
      windowDays: query.windowDays ?? DEFAULT_WINDOW_DAYS,
    };

    if (grade !== "RAW") {
      return emptyMarketComp(ctx, "catalog market prices are raw-card signals only");
    }

    try {
      const catalogCard = await this.catalog.resolve(card);
      return mapCatalogCardToMarketComp(catalogCard, ctx);
    } catch {
      return emptyMarketComp(ctx, "catalog market lookup failed");
    }
  }
}

export function mapCatalogCardToMarketComp(
  catalogCard: CatalogCard | null,
  ctx: MarketContext,
): CompResult {
  const bestSignal = pickCatalogPriceSignal(catalogCard?.priceSignals);
  if (!catalogCard || !bestSignal) {
    return emptyMarketComp(ctx, "no catalog market price");
  }

  const canonicalCard: CardRef = {
    ...ctx.card,
    name: catalogCard.name,
    setName: catalogCard.setName,
    number: catalogCard.number,
    tcgApiId: catalogCard.tcgApiId,
    game: catalogCard.game,
    language: catalogCard.language,
  };

  return {
    source: ctx.source,
    card: canonicalCard,
    grade: ctx.grade,
    currency: "GBP",
    medianPence: bestSignal.pricePence,
    meanPence: bestSignal.pricePence,
    lowPence: bestSignal.pricePence,
    highPence: bestSignal.pricePence,
    sampleSize: 1,
    windowDays: MARKET_WINDOW_DAYS,
    trendPct: null,
    outliersRemoved: 0,
    asOf: parseMarketDate(bestSignal.updatedAt),
    raw: {
      kind: "catalog-market-baseline",
      caveat: "TCGPlayer/Cardmarket market data, not a cleaned sold-comps sample.",
      chosenSignal: bestSignal,
      signals: catalogCard.priceSignals ?? [],
    },
  };
}

function emptyMarketComp(ctx: MarketContext, reason: string): CompResult {
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
    raw: { kind: "catalog-market-baseline", reason },
  };
}

function parseMarketDate(value: CatalogPriceSignal["updatedAt"]): string {
  if (!value) return new Date().toISOString();
  const slashDate = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slashDate) {
    return `${slashDate[1]}-${slashDate[2]}-${slashDate[3]}T00:00:00.000Z`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
