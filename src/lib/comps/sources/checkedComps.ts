import { PrismaCardCache, toCardRef, type PrismaCardDb, type PrismaCard } from "../../catalog/prismaCardCache.js";
import type { CatalogSource } from "../../catalog/types.js";
import type { CardRef, CompQuery, CompResult, Grade, RawCondition } from "../../domain/types.js";
import { normalizeCollectorNumberForCompare } from "../../cards/identity.js";
import type { CompSource } from "../CompSource.js";
import { mean, median, removeOutliersIQR } from "../cleaning.js";
import { normalizeRawCondition } from "../pricing.js";

export type CheckedCompPlatform = "ebay-uk" | "cardmarket" | "vinted" | "other";
export type CheckedCompPriceBasis = "DISPLAYED_PRICE" | "ITEM_PRICE" | "BUYER_TOTAL" | "BEST_OFFER_UNKNOWN" | "UNKNOWN";
export type CheckedCompEvidenceStatus = "used" | "corroboration" | "outlier";

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
  condition: string | null;
  priceBasis: string;
  note: string | null;
  sourceUrl: string | null;
  sourceListingId: string | null;
  createdAt: Date;
  card: CheckedCompCard;
};

export type CreateCheckedCompInput = {
  card: CardRef;
  grade: Grade;
  pricePence: number;
  soldDate?: Date;
  platform?: CheckedCompPlatform;
  condition?: RawCondition | string;
  priceBasis?: CheckedCompPriceBasis;
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
        condition?: RawCondition;
        priceBasis: CheckedCompPriceBasis;
        note?: string;
        sourceUrl?: string;
        sourceListingId?: string;
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

export type CheckedCompsContext = {
  source: string;
  card: CardRef;
  grade: Grade;
  condition?: RawCondition;
  windowDays: number;
  now?: Date;
};

type EvidenceDecision = {
  row: CheckedCompRow;
  listingId: string | null;
  status: CheckedCompEvidenceStatus;
  reasons: string[];
};

const SOURCE_NAME = "checked-comps";
const DEFAULT_CHECKED_COMP_WINDOW_DAYS = 90;
const MAX_CHECKED_COMPS = 50;
const MAX_CHECKED_COMP_PENCE = 100_000_000;
const GROSS_SPREAD_LIMIT = 4;

export class CheckedCompEvidenceError extends Error {
  constructor(message: string, readonly code: "invalid-source-url" | "invalid-condition" | "invalid-price" | "invalid-date") {
    super(message);
  }
}

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
    if (!Number.isFinite(pricePence) || pricePence <= 0 || pricePence > MAX_CHECKED_COMP_PENCE) {
      throw new CheckedCompEvidenceError("Checked comp price must be between £0.01 and £1,000,000.", "invalid-price");
    }

    const soldDate = input.soldDate ?? new Date();
    // Permit a small clock-skew margin, not a future calendar day. Future rows
    // are excluded again by the aggregate mapper as a second line of defence.
    const latestAllowed = new Date(Date.now() + 5 * 60 * 1000);
    if (!Number.isFinite(soldDate.getTime()) || soldDate.getTime() > latestAllowed.getTime()) {
      throw new CheckedCompEvidenceError("Sold date cannot be in the future.", "invalid-date");
    }

    const platform = normalizeCheckedCompPlatform(input.platform);
    const condition = input.grade === "RAW" ? normalizeRawCondition(input.condition) : null;
    if (input.grade === "RAW" && !condition) {
      throw new CheckedCompEvidenceError("RAW checked comps need NM, LP, MP, HP or DMG condition.", "invalid-condition");
    }

    const source = normalizeCheckedCompSource(platform, input.sourceUrl);
    const card = await this.cardCache.resolve(input.card);
    return this.db.checkedComp.create({
      data: {
        cardId: card.id,
        grade: input.grade,
        pricePence,
        soldDate,
        platform,
        priceBasis: normalizeCheckedCompPriceBasis(input.priceBasis),
        ...(condition ? { condition } : {}),
        ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
        ...(source.url ? { sourceUrl: source.url } : {}),
        ...(source.listingId ? { sourceListingId: source.listingId } : {}),
      },
      include: { card: true },
    });
  }

  async list(
    card: CardRef,
    grade: Grade,
    windowDays = DEFAULT_CHECKED_COMP_WINDOW_DAYS,
    condition?: RawCondition,
  ): Promise<CheckedCompRow[]> {
    return this.db.checkedComp.findMany({
      where: buildCheckedCompsWhere(card, grade, windowDays, condition),
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
    const ctx = { source: this.name, card, grade, condition: query.condition, windowDays };

    if (grade === "RAW" && !query.condition) {
      return emptyCheckedCompsComp(ctx, "RAW checked comps need an exact condition bucket");
    }

    try {
      const rows = await this.db.checkedComp.findMany({
        where: buildCheckedCompsWhere(card, grade, windowDays, query.condition),
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

/**
 * Only distinct, traceable eBay UK sold pages can back the aggregate. All
 * dealer observations remain in `raw.entries`, with explicit reasons when an
 * entry is corroboration-only or removed as an outlier.
 */
export function mapCheckedCompsToComp(rows: CheckedCompRow[], ctx: CheckedCompsContext): CompResult {
  const now = ctx.now ?? new Date();
  const cutoff = now.getTime() - ctx.windowDays * 24 * 60 * 60 * 1000;
  const recent = rows
    .filter((row) => row.grade === ctx.grade)
    .filter((row) => row.pricePence > 0 && row.pricePence <= MAX_CHECKED_COMP_PENCE)
    .filter((row) => row.soldDate.getTime() >= cutoff && row.soldDate.getTime() <= now.getTime())
    .sort((a, b) => a.soldDate.getTime() - b.soldDate.getTime());

  const decisions = qualifyEvidence(recent, ctx);
  const traceable = decisions.filter((decision) => decision.status === "used");
  const cleaned = removeCheckedCompOutliers(traceable);
  const keptIds = new Set(cleaned.kept.map((decision) => decision.row.id));
  const outlierIds = new Set(cleaned.removed.map((decision) => decision.row.id));
  const finalDecisions = decisions.map((decision) => {
    if (outlierIds.has(decision.row.id)) {
      return { ...decision, status: "outlier" as const, reasons: [...decision.reasons, "price-outlier"] };
    }
    if (decision.status === "used" && !keptIds.has(decision.row.id)) {
      return { ...decision, status: "corroboration" as const, reasons: [...decision.reasons, "duplicate-listing"] };
    }
    return decision;
  });
  const used = finalDecisions.filter((decision) => decision.status === "used");
  const entries = finalDecisions
    .slice()
    .sort((a, b) => b.row.soldDate.getTime() - a.row.soldDate.getTime())
    .map(checkedCompDecisionForRaw);

  if (used.length === 0) {
    const reason = ctx.grade === "RAW" && !ctx.condition
      ? "RAW checked comps need an exact condition bucket"
      : recent.length === 0
        ? "no matching checked comps"
        : "no traceable condition-matched eBay UK sold listings";
    return emptyCheckedCompsComp(ctx, reason, entries, cleaned.removed.length);
  }

  const prices = used.map((decision) => decision.row.pricePence);
  const latest = used.reduce((best, decision) =>
    decision.row.soldDate.getTime() > best.row.soldDate.getTime() ? decision : best,
  );
  const med = Math.round(median(prices));

  return {
    source: ctx.source,
    card: toCardRef(latest.row.card),
    grade: ctx.grade,
    currency: "GBP",
    medianPence: med,
    meanPence: Math.round(mean(prices)),
    lowPence: Math.min(...prices),
    highPence: Math.max(...prices),
    sampleSize: used.length,
    windowDays: ctx.windowDays,
    trendPct: null,
    outliersRemoved: cleaned.removed.length,
    asOf: latest.row.soldDate.toISOString(),
    raw: {
      kind: "checked-comps",
      caveat: "Distinct dealer-checked eBay UK displayed sold prices for this exact card, grade and RAW condition; delivery is excluded.",
      region: "UK",
      condition: ctx.grade === "RAW" ? ctx.condition : undefined,
      conditionMatched: true,
      traceableCount: used.length,
      corroborationCount: finalDecisions.filter((decision) => decision.status === "corroboration").length,
      outlierCount: cleaned.removed.length,
      grossSpread: prices.length > 1 ? Math.max(...prices) / Math.min(...prices) : 1,
      entries,
    },
  };
}

export function checkedCompRowForRaw(row: CheckedCompRow) {
  const directListingId = checkedCompSourceListingId(row.platform, row.sourceUrl);
  const listingId = directListingId ?? normalizeStoredListingId(row.sourceListingId);
  return {
    id: row.id,
    cardId: row.cardId,
    grade: row.grade,
    pricePence: row.pricePence,
    soldDate: row.soldDate.toISOString(),
    platform: normalizeCheckedCompPlatform(row.platform),
    condition: normalizeRawCondition(row.condition) ?? undefined,
    priceBasis: normalizeCheckedCompPriceBasis(row.priceBasis),
    note: row.note ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    sourceListingId: listingId ?? undefined,
    traceable: Boolean(directListingId && normalizeCheckedCompPlatform(row.platform) === "ebay-uk"),
    createdAt: row.createdAt.toISOString(),
  };
}

export function checkedCompEntriesFromAggregate(comp: CompResult, fallback: CheckedCompRow[] = []): unknown[] {
  const raw = comp.raw && typeof comp.raw === "object" ? comp.raw as Record<string, unknown> : null;
  return Array.isArray(raw?.entries) ? raw.entries : fallback.map(checkedCompRowForRaw);
}

export function buildCheckedCompsWhere(
  card: CardRef,
  grade: Grade,
  windowDays: number,
  condition?: RawCondition,
): unknown {
  const soldAfter = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  return {
    grade,
    condition: grade === "RAW" ? condition ?? null : null,
    soldDate: { gte: soldAfter },
    card: cardLookupWhere(card),
  };
}

export function normalizeCheckedCompPlatform(platform: string | undefined): CheckedCompPlatform {
  if (platform === "cardmarket" || platform === "vinted" || platform === "other") return platform;
  if (platform == null || platform.trim() === "" || platform === "ebay-uk") return "ebay-uk";
  return "other";
}

export function checkedCompPlatformRegion(platform: string | undefined): "UK" | "EU" {
  return normalizeCheckedCompPlatform(platform) === "cardmarket" ? "EU" : "UK";
}

export function normalizeCheckedCompPriceBasis(value: string | undefined): CheckedCompPriceBasis {
  if (value === "DISPLAYED_PRICE" || value === "ITEM_PRICE" || value === "BUYER_TOTAL" || value === "BEST_OFFER_UNKNOWN") return value;
  return "UNKNOWN";
}

export function checkedCompSourceListingId(platform: string | undefined, sourceUrl: string | null | undefined): string | null {
  if (normalizeCheckedCompPlatform(platform) !== "ebay-uk" || !sourceUrl?.trim()) return null;
  let url: URL;
  try {
    url = new URL(sourceUrl.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (url.protocol !== "https:" || host !== "ebay.co.uk") return null;
  const pathMatch = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})(?:\/|$)/i);
  const queryId = /^\/itm\/?$/i.test(url.pathname) ? url.searchParams.get("item") ?? url.searchParams.get("itemId") : null;
  const itemId = pathMatch?.[1] ?? (queryId && /^\d{9,15}$/.test(queryId) ? queryId : null);
  return itemId ? `ebay-uk:${itemId}` : null;
}

export function normalizeCheckedCompSource(
  platform: CheckedCompPlatform,
  sourceUrl: string | undefined,
): { url?: string; listingId?: string } {
  const cleanUrl = cleanOptional(sourceUrl);
  if (!cleanUrl) return {};
  let parsed: URL;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    throw new CheckedCompEvidenceError("Source link must be a valid HTTPS URL.", "invalid-source-url");
  }
  if (parsed.protocol !== "https:") {
    throw new CheckedCompEvidenceError("Source link must use HTTPS.", "invalid-source-url");
  }
  if (platform !== "ebay-uk") return { url: parsed.toString() };
  const listingId = checkedCompSourceListingId(platform, parsed.toString());
  if (!listingId) {
    throw new CheckedCompEvidenceError(
      "For trusted eBay UK evidence, open the individual sold item and paste its /itm/ link; sold-search links are not unique evidence.",
      "invalid-source-url",
    );
  }
  const itemId = listingId.slice("ebay-uk:".length);
  return { url: `https://www.ebay.co.uk/itm/${itemId}`, listingId };
}

function qualifyEvidence(rows: CheckedCompRow[], ctx: CheckedCompsContext): EvidenceDecision[] {
  const seenListings = new Set<string>();
  return rows.map((row) => {
    const reasons: string[] = [];
    const platform = normalizeCheckedCompPlatform(row.platform);
    const listingId = checkedCompSourceListingId(platform, row.sourceUrl);
    const storedListingId = normalizeStoredListingId(row.sourceListingId);
    if (platform !== "ebay-uk") reasons.push("not-ebay-uk");
    if (!listingId) reasons.push("missing-direct-sold-listing");
    if (listingId && storedListingId && listingId !== storedListingId) reasons.push("listing-id-mismatch");
    const priceBasis = normalizeCheckedCompPriceBasis(row.priceBasis);
    // eBay UK includes Buyer Protection in the price a UK buyer sees for
    // private listings. The sold-search price, with delivery shown separately,
    // is the buyer-visible market comparison Poke Deal needs. Older rows
    // explicitly recorded as seller item price remain valid; checkout totals
    // and hidden Best Offers do not.
    if (priceBasis !== "DISPLAYED_PRICE" && priceBasis !== "ITEM_PRICE") reasons.push("inexact-price-basis");
    if (ctx.grade === "RAW") {
      const rowCondition = normalizeRawCondition(row.condition);
      if (!ctx.condition) reasons.push("lookup-condition-missing");
      else if (!rowCondition) reasons.push("entry-condition-missing");
      else if (rowCondition !== ctx.condition) reasons.push(`condition-mismatch:${rowCondition}`);
    }
    if (listingId && seenListings.has(listingId)) reasons.push("duplicate-listing");
    if (listingId) seenListings.add(listingId);
    return {
      row,
      listingId,
      status: reasons.length === 0 ? "used" : "corroboration",
      reasons,
    };
  });
}

function removeCheckedCompOutliers(decisions: EvidenceDecision[]): { kept: EvidenceDecision[]; removed: EvidenceDecision[] } {
  if (decisions.length < 4) return { kept: decisions, removed: [] };
  const { kept: keptPrices } = removeOutliersIQR(decisions.map((decision) => decision.row.pricePence));
  const remaining = [...keptPrices];
  const kept: EvidenceDecision[] = [];
  const removed: EvidenceDecision[] = [];
  for (const decision of decisions) {
    const index = remaining.indexOf(decision.row.pricePence);
    if (index >= 0) {
      kept.push(decision);
      remaining.splice(index, 1);
    } else {
      removed.push(decision);
    }
  }
  return { kept, removed };
}

function checkedCompDecisionForRaw(decision: EvidenceDecision) {
  return {
    ...checkedCompRowForRaw(decision.row),
    evidenceStatus: decision.status,
    exclusionReasons: decision.reasons.length > 0 ? decision.reasons : undefined,
  };
}

function cardLookupWhere(card: CardRef): unknown {
  if (card.id) return { id: card.id };
  if (card.tcgApiId) return { tcgApiId: card.tcgApiId };
  if (card.tcgDexId) return { tcgDexId: card.tcgDexId };
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

function emptyCheckedCompsComp(
  ctx: CheckedCompsContext,
  reason: string,
  entries: unknown[] = [],
  outliersRemoved = 0,
): CompResult {
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
    outliersRemoved,
    asOf: (ctx.now ?? new Date()).toISOString(),
    raw: {
      kind: "checked-comps",
      reason,
      region: "UK",
      condition: ctx.grade === "RAW" ? ctx.condition : undefined,
      conditionMatched: false,
      traceableCount: 0,
      entries,
    },
  };
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStoredListingId(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^ebay-uk:(\d{9,15})$/);
  return match ? `ebay-uk:${match[1]}` : null;
}
