import type { CardRef, CompQuery, CompResult, Currency, Grade, RawSale } from "../../domain/types.js";
import type { CompSource } from "../CompSource.js";
import { cleanToComp, DEFAULT_WINDOW_DAYS } from "../cleaning.js";
import { getEbayConfig, hasEbayRefreshToken, EBAY_UK_CATEGORY_POKEMON } from "../../ebay/config.js";
import { getAccessToken } from "../../ebay/tokens.js";
import type { EbayConfig } from "../../ebay/config.js";

const DEFAULT_FETCH_TIMEOUT_MS = 6500;
const DEFAULT_LIMIT = 50;
const SOURCE_NAME = "ebay-marketplace-insights";

type EbayMoney = {
  value?: unknown;
  currency?: unknown;
};

type EbaySaleItem = {
  itemId?: unknown;
  legacyItemId?: unknown;
  title?: unknown;
  itemWebUrl?: unknown;
  price?: EbayMoney;
  convertedFromPrice?: EbayMoney;
  itemSoldDate?: unknown;
  soldDate?: unknown;
  dateSold?: unknown;
  itemCreationDate?: unknown;
};

type EbayItemSalesPayload = {
  itemSales?: EbaySaleItem[];
  itemSummaries?: EbaySaleItem[];
  href?: unknown;
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
  warnings?: unknown;
};

type EbayMiContext = {
  source: string;
  card: CardRef;
  grade: Grade;
  windowDays: number;
};

export class EbayMarketplaceInsightsSource implements CompSource {
  readonly name = SOURCE_NAME;
  readonly live: boolean;

  constructor(
    private readonly config: EbayConfig | null = getEbayConfig(),
    private readonly enabled = process.env.EBAY_MARKETPLACE_INSIGHTS_ENABLED?.trim().toLowerCase() === "true",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  ) {
    this.live = Boolean(this.enabled && this.config && hasEbayRefreshToken());
  }

  async lookup(card: CardRef, query: CompQuery = {}): Promise<CompResult> {
    const grade = query.grade ?? "RAW";
    const windowDays = query.windowDays ?? DEFAULT_WINDOW_DAYS;
    const ctx = { source: this.name, card, grade, windowDays };
    if (!this.enabled) return emptyComp(ctx, "eBay Marketplace Insights is not enabled");
    if (!this.config) return emptyComp(ctx, "eBay credentials are not configured");
    if (!hasEbayRefreshToken()) return emptyComp(ctx, "eBay account is not connected");

    try {
      const accessToken = await getAccessToken(this.config, this.fetchImpl);
      const payload = await this.fetchItemSales(this.config, accessToken, card, grade, windowDays);
      const comp = mapEbayMarketplaceInsightsToComp(payload, ctx);
      return comp.sampleSize > 0
        ? {
            ...comp,
            raw: {
              kind: "uk-ebay-sold-comps",
              query: buildEbayMarketplaceInsightsQuery(card, grade),
              endpoint: "buy/marketplace_insights/v1_beta/item_sales/search",
              total: readPositiveInt((payload as EbayItemSalesPayload).total),
              warnings: (payload as EbayItemSalesPayload).warnings,
            },
          }
        : comp;
    } catch (err) {
      return emptyComp(ctx, err instanceof Error ? err.message : "eBay Marketplace Insights lookup failed");
    }
  }

  private async fetchItemSales(
    config: EbayConfig,
    accessToken: string,
    card: CardRef,
    grade: Grade,
    windowDays: number,
  ): Promise<unknown> {
    const params = new URLSearchParams({
      q: buildEbayMarketplaceInsightsQuery(card, grade),
      category_ids: EBAY_UK_CATEGORY_POKEMON,
      limit: String(DEFAULT_LIMIT),
      filter: buildMarketplaceInsightsFilter(windowDays),
      sort: "price",
    });
    const response = await this.fetchImpl(
      `${config.apiBaseUrl}/buy/marketplace_insights/v1_beta/item_sales/search?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "X-EBAY-C-MARKETPLACE-ID": config.marketplaceId,
        },
        signal: timeoutSignal(this.fetchTimeoutMs),
      },
    );

    if (!response.ok) {
      const detail = await readEbayError(response);
      throw new Error(`eBay Marketplace Insights ${response.status}: ${detail}`);
    }

    return response.json() as Promise<unknown>;
  }
}

export function buildEbayMarketplaceInsightsQuery(card: CardRef, grade: Grade): string {
  const core = [card.name, humanizeCollectorNumber(card.number), card.setName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!core) return "";
  if (grade === "RAW") return `${core} -PSA -BGS -CGC -ACE -SGC -graded`;
  const gradeLabel = grade.replace(/_(\d)_5$/g, " $1.5").replace(/_(\d+)$/g, " $1").replace(/_/g, " ");
  return `${core} ${gradeLabel}`;
}

export function mapEbayMarketplaceInsightsToComp(json: unknown, ctx: EbayMiContext): CompResult {
  const sales = readItemSales(json).map(mapEbaySale).filter((sale): sale is RawSale => Boolean(sale));
  const comp = cleanToComp({
    source: ctx.source,
    card: ctx.card,
    grade: ctx.grade,
    sales,
    windowDays: ctx.windowDays,
  });
  return comp.sampleSize > 0
    ? comp
    : emptyComp(ctx, sales.length > 0 ? "eBay MI returned sales but none survived cleaning" : "eBay MI returned no item sales");
}

function readItemSales(json: unknown): EbaySaleItem[] {
  const payload = json as EbayItemSalesPayload | null;
  if (Array.isArray(payload?.itemSales)) return payload.itemSales;
  if (Array.isArray(payload?.itemSummaries)) return payload.itemSummaries;
  return [];
}

function mapEbaySale(item: EbaySaleItem): RawSale | null {
  const money = readMoney(item.price) ?? readMoney(item.convertedFromPrice);
  const soldAt = readString(item.itemSoldDate) ?? readString(item.soldDate) ?? readString(item.dateSold) ?? readString(item.itemCreationDate);
  if (!money || !soldAt) return null;
  const title = readString(item.title) ?? undefined;
  const externalId = readString(item.itemId) ?? readString(item.legacyItemId) ?? undefined;
  return {
    amount: money.amount,
    currency: money.currency,
    soldAt,
    title,
    gradeLabel: title,
    externalId,
  };
}

function readMoney(value: EbayMoney | undefined): { amount: number; currency: Currency } | null {
  const amount = Number(value?.value);
  const currency = value?.currency;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (currency !== "GBP" && currency !== "EUR" && currency !== "USD" && currency !== "JPY") return null;
  return { amount, currency };
}

function buildMarketplaceInsightsFilter(windowDays: number): string {
  const safeDays = Math.max(1, Math.min(90, Math.round(windowDays)));
  const start = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  return `soldDate:[${start}..]`;
}

function humanizeCollectorNumber(number: string | undefined): string | undefined {
  return number?.replace(/^(SVP|MEP)\s*0*(\d{1,4})$/i, (_, prefix: string, digits: string) =>
    `${prefix.toUpperCase()} ${digits.padStart(3, "0")}`,
  );
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function emptyComp(ctx: EbayMiContext, reason: string): CompResult {
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
    raw: { kind: "uk-ebay-sold-comps", reason },
  };
}

async function readEbayError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { errors?: Array<{ longMessage?: string; message?: string }> };
    return body.errors?.[0]?.longMessage ?? body.errors?.[0]?.message ?? `HTTP ${response.status}`;
  } catch {
    return response.text().then((text) => text.slice(0, 500)).catch(() => `HTTP ${response.status}`);
  }
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
}
