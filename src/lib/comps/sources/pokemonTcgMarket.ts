import type { CatalogCard, CatalogPriceSignal, CatalogSource } from "../../catalog/types.js";
import { catalogCardMatchesLookupContext, catalogCardMatchesSetContext } from "../../catalog/cardSearch.js";
import { PokemonTcgApiCatalogSource, pickCatalogPriceSignal } from "../../catalog/pokemonTcgApi.js";
import { getSetById } from "../../catalog/setCatalog.js";
import type { CardRef, CompQuery, CompResult, Grade } from "../../domain/types.js";
import type { CompSource, CompSourceContext } from "../CompSource.js";
import { DEFAULT_WINDOW_DAYS } from "../cleaning.js";
import {
  addRequestedVariantHint,
  detectCardPrintIdentity,
  requestsFirstEdition,
  requestsHolo,
  requestsNormal,
  requestsReverseHolo,
} from "../variants.js";

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

  async lookup(card: CardRef, query: CompQuery = {}, context: CompSourceContext = {}): Promise<CompResult> {
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
      const catalogCard = await this.catalog.resolve(card, { signal: context.signal });
      if (!catalogCardMatchesSetContext(catalogCard, card.setName)) {
        return emptyMarketComp(ctx, "catalog card did not match requested set");
      }
      if (!catalogCardMatchesLookupContext(catalogCard, card)) {
        return emptyMarketComp(ctx, "catalog card did not match requested card");
      }
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
  const priceSignals = filterVintageTrendPrice(catalogCard);
  const bestSignal = pickCatalogPriceSignalForRequest(priceSignals, ctx.card);
  if (!catalogCard || !bestSignal) {
    return emptyMarketComp(
      ctx,
      requestsFirstEdition(ctx.card) ? "no first edition catalog market price" : "no catalog market price",
    );
  }

  const canonicalCard: CardRef = {
    ...ctx.card,
    name: addRequestedVariantHint(catalogCard.name, ctx.card.name),
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
    trendPct: extractCatalogSignalTrendPct(priceSignals),
    outliersRemoved: 0,
    asOf: parseMarketDate(bestSignal.updatedAt),
    raw: {
      kind: "catalog-market-baseline",
      caveat: "TCGPlayer/Cardmarket market data, not a cleaned sold-comps sample.",
      chosenSignal: bestSignal,
      signals: priceSignals ?? [],
      fx: bestSignal.fx,
    },
  };
}

export function pickCatalogPriceSignalForRequest(
  signals: CatalogPriceSignal[] | undefined,
  card: CardRef,
): CatalogPriceSignal | null {
  if (!signals || signals.length === 0) return null;
  const requested = { ...detectCardPrintIdentity(card), edition: card.edition ?? detectCardPrintIdentity(card).edition, finish: card.finish ?? detectCardPrintIdentity(card).finish };
  let eligible = signals;

  if (requested.edition === "FIRST_EDITION") {
    eligible = eligible.filter((signal) => normalizeSignalVariant(signal.variant).startsWith("1stedition"));
  } else if (requested.edition === "UNLIMITED") {
    eligible = eligible.filter((signal) => normalizeSignalVariant(signal.variant).startsWith("unlimited"));
  } else if (requested.edition) {
    return null;
  }
  if (eligible.length === 0) return null;

  if (requestsReverseHolo(card) || requested.finish === "REVERSE_HOLO") {
    eligible = eligible.filter((signal) => normalizeSignalVariant(signal.variant).startsWith("reverseholo"));
  } else if (requestsHolo(card) || requested.finish === "HOLO") {
    eligible = eligible.filter((signal) => {
      const variant = normalizeSignalVariant(signal.variant);
      return variant.includes("holo") && !variant.includes("reverse");
    });
  } else if (requestsNormal(card) || requested.finish === "NORMAL") {
    eligible = eligible.filter((signal) => {
      const variant = normalizeSignalVariant(signal.variant);
      return variant === "normal" || variant.endsWith("normal");
    });
  }
  return eligible.length > 0 ? pickCatalogPriceSignal(eligible) : null;
}

function extractCatalogSignalTrendPct(signals: CatalogPriceSignal[] | undefined): number | null {
  if (!signals || signals.length === 0) return null;
  const avg30 = readSignalAmount(signals, "cardmarket", "avg30");
  const avg7 = readSignalAmount(signals, "cardmarket", "avg7");
  if (!avg30 || avg30 <= 0 || !avg7) return null;
  return Math.round(((avg7 - avg30) / avg30) * 1000) / 10;
}

function filterVintageTrendPrice(catalogCard: CatalogCard | null): CatalogPriceSignal[] | undefined {
  const signals = catalogCard?.priceSignals;
  if (!signals || signals.length === 0) return signals;
  if (!isVintageCatalogCard(catalogCard)) return signals;
  return signals.filter((signal) => !(signal.source === "cardmarket" && signal.kind === "trendPrice"));
}

function isVintageCatalogCard(card: CatalogCard): boolean {
  const setId = card.setCode ?? card.tcgApiId?.split("-")[0];
  const release = setId ? getSetById(setId)?.releaseDate : undefined;
  return Boolean(release && release < "2003-01-01");
}

function readSignalAmount(signals: CatalogPriceSignal[], source: "cardmarket" | "tcgplayer", kind: string): number | null {
  const match = signals.find((signal) => signal.source === source && signal.kind === kind);
  return match ? Number(match.pricePence) : null;
}

function normalizeSignalVariant(value: string | undefined): string {
  return (value ?? "").toLowerCase();
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
  if (!value) return "unknown";
  const slashDate = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slashDate) {
    return `${slashDate[1]}-${slashDate[2]}-${slashDate[3]}T00:00:00.000Z`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString();
}
