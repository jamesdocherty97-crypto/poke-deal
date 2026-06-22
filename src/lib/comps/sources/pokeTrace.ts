import type { CardRef, CompQuery, CompResult, Grade } from "../../domain/types.js";
import type { CompSource } from "../CompSource.js";
import { DEFAULT_WINDOW_DAYS } from "../cleaning.js";
import { STATIC_RATES, toGbpPence, type FxRates } from "../currency.js";

const BASE_URL = "https://api.poketrace.com/v1";
const DEFAULT_FETCH_TIMEOUT_MS = 6500;

type PokeTraceMarket = "US" | "EU";

type PokeTracePriceTier = {
  avg?: unknown;
  low?: unknown;
  high?: unknown;
  saleCount?: unknown;
  approxSaleCount?: unknown;
  avg1d?: unknown;
  avg7d?: unknown;
  avg30d?: unknown;
};

type PokeTraceCard = {
  id?: unknown;
  name?: unknown;
  cardNumber?: unknown;
  set?: { name?: unknown; slug?: unknown };
  market?: unknown;
  currency?: unknown;
  prices?: Record<string, Record<string, PokeTracePriceTier | undefined> | undefined>;
  lastUpdated?: unknown;
  totalSaleCount?: unknown;
};

type PokeTracePayload = {
  data?: PokeTraceCard | PokeTraceCard[];
};

type PokeTraceTierChoice = {
  tier: PokeTracePriceTier;
  tierKey: string;
  priceSource: string;
  kind: "market-baseline" | "sold-aggregate";
};

type MapContext = {
  source: string;
  card: CardRef;
  grade: Grade;
  windowDays: number;
};

export class PokeTraceSource implements CompSource {
  readonly name = "poketrace";
  readonly live: boolean;

  constructor(
    private readonly apiKey: string | undefined = process.env.POKETRACE_API_KEY,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  ) {
    this.live = Boolean(apiKey && apiKey.trim().length > 0);
  }

  async lookup(card: CardRef, query: CompQuery = {}): Promise<CompResult> {
    const grade = query.grade ?? "RAW";
    const windowDays = query.windowDays ?? DEFAULT_WINDOW_DAYS;
    const ctx = { source: this.name, card, grade, windowDays };
    if (!this.live) return emptyComp(ctx);

    const payload = await this.fetchCards(card);
    return mapPokeTraceCardsToComp(payload, ctx);
  }

  private async fetchCards(card: CardRef): Promise<unknown | null> {
    const search = [card.name, card.number].filter(Boolean).join(" ");
    const params = new URLSearchParams({
      search,
      market: "US" satisfies PokeTraceMarket,
      product_type: "single",
      limit: "1",
    });

    try {
      const res = await this.fetchImpl(`${BASE_URL}/cards?${params.toString()}`, {
        headers: { "X-API-Key": this.apiKey ?? "", Accept: "application/json" },
        signal: timeoutSignal(this.fetchTimeoutMs),
      });
      if (!res.ok) {
        console.warn(`[${this.name}] HTTP ${res.status} - no comp returned`);
        return null;
      }
      return (await res.json()) as unknown;
    } catch (err) {
      console.warn(`[${this.name}] fetch failed: ${(err as Error).message}`);
      return null;
    }
  }
}

export function gradeToPokeTraceTier(grade: Grade): string {
  return grade === "RAW" ? "NEAR_MINT" : grade;
}

export function mapPokeTraceCardsToComp(
  json: unknown,
  ctx: MapContext,
  rates: FxRates = STATIC_RATES,
): CompResult {
  const payload = json as PokeTracePayload | null;
  const card = (Array.isArray(payload?.data) ? payload!.data[0] : payload?.data) as PokeTraceCard | undefined;
  if (!card) return emptyComp(ctx);

  const choice = chooseTier(card, ctx.grade);
  if (!choice) return emptyComp(ctx);

  const currency = readCurrency(card.currency);
  if (!currency) return emptyComp(ctx);

  const avgPence = priceToGbpPence(choice.tier.avg, currency, rates);
  if (avgPence <= 0) return emptyComp(ctx);

  const lowPence = priceToGbpPence(choice.tier.low, currency, rates) || avgPence;
  const highPence = priceToGbpPence(choice.tier.high, currency, rates) || avgPence;
  const sampleSize = readPositiveInt(choice.tier.saleCount) ?? readPositiveInt(card.totalSaleCount) ?? 1;
  const canonicalCard = canonicalCardRef(ctx.card, card);

  return {
    source: ctx.source,
    card: canonicalCard,
    grade: ctx.grade,
    currency: "GBP",
    medianPence: avgPence,
    meanPence: avgPence,
    lowPence,
    highPence,
    sampleSize,
    windowDays: ctx.windowDays,
    trendPct: trendPct(choice.tier),
    outliersRemoved: 0,
    asOf: parseDate(card.lastUpdated),
    raw: {
      kind: choice.kind,
      tier: choice.tierKey,
      priceSource: choice.priceSource,
      market: readString(card.market),
      currency,
      approxSaleCount: Boolean(choice.tier.approxSaleCount),
      ...choice.tier,
    },
  };
}

function chooseTier(card: PokeTraceCard, grade: Grade): PokeTraceTierChoice | null {
  const tierKey = gradeToPokeTraceTier(grade);
  if (grade === "RAW") {
    const tcgplayer = card.prices?.tcgplayer?.[tierKey];
    if (tcgplayer) return { tier: tcgplayer, tierKey, priceSource: "tcgplayer", kind: "market-baseline" };
    const ebay = card.prices?.ebay?.[tierKey];
    if (ebay) return { tier: ebay, tierKey, priceSource: "ebay", kind: "sold-aggregate" };
    return null;
  }

  const ebay = card.prices?.ebay?.[tierKey];
  if (ebay) return { tier: ebay, tierKey, priceSource: "ebay", kind: "sold-aggregate" };
  const cardmarket = card.prices?.cardmarket_unsold?.[tierKey];
  if (cardmarket) return { tier: cardmarket, tierKey, priceSource: "cardmarket_unsold", kind: "market-baseline" };
  return null;
}

function emptyComp(ctx: MapContext): CompResult {
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
  };
}

function canonicalCardRef(input: CardRef, card: PokeTraceCard): CardRef {
  return {
    ...input,
    name: readString(card.name) ?? input.name,
    setName: readString(card.set?.name) ?? input.setName,
    number: readString(card.cardNumber) ?? input.number,
    game: "POKEMON",
    language: input.language ?? "EN",
  };
}

function priceToGbpPence(value: unknown, currency: "USD" | "EUR", rates: FxRates): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? toGbpPence(n, currency, rates) : 0;
}

function readCurrency(value: unknown): "USD" | "EUR" | null {
  return value === "USD" || value === "EUR" ? value : null;
}

function readPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseDate(value: unknown): string {
  const date = new Date(typeof value === "string" ? value : Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function trendPct(tier: PokeTracePriceTier): number | null {
  const current = Number(tier.avg);
  const older = Number(tier.avg30d ?? tier.avg7d);
  if (!Number.isFinite(current) || !Number.isFinite(older) || older <= 0) return null;
  return Math.round(((current - older) / older) * 1000) / 10;
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
}
