import type { CatalogCard } from "../catalog/types.js";
import { PokemonTcgApiCatalogSource } from "../catalog/pokemonTcgApi.js";
import type { CardRef, Grade } from "../domain/types.js";
import { attachAskEvidence, fetchEbayAskEvidence } from "../ebay/browseAsks.js";
import { buildPsaCompSearchParams, isPsaPokemonTcgCert } from "../psa/lookupFields.js";
import { PsaCertLookup } from "../psa/psaCert.js";
import {
  catalogToCardRef,
  createAppCompService,
  findAmbiguousCatalogCandidates,
  findCatalogAlternatives,
  fixedCatalogSource,
  requestHasExplicitCardNumber,
  resolveBareSetAmbiguity,
  resolveCatalogCard,
} from "./appCompLookup.js";
import { resolveCompCardImage } from "./cardArt.js";
import { persistResolvedDisplayImage, withResolvedDisplayImage } from "./cardArtPersistence.js";
import { reconcileCompReceipt, type CompSourceProgress } from "./compService.js";
import type { AppCompReceipt } from "./progressContract.js";
import { PrismaCompResultRepo } from "./prismaCompResultRepo.js";
import { readCompLookupRequest } from "./request.js";

const RECOVERY_ALTERNATIVES_TIMEOUT_MS = 5_000;
const CATALOG_RESOLVE_TIMEOUT_MS = 3_600;
const EBAY_ASK_TIMEOUT_MS = 3_500;
const MIN_AMBIGUOUS_ALTERNATIVES = 5;

export type AppCompCatalogProgress = {
  requested: CardRef;
  identity: CardRef;
  grade: Grade;
  catalog: CatalogCard | null;
  ambiguity: "pending" | boolean;
  sources: Array<{ name: string; live: boolean }>;
};

export interface AppCompLookupFlowOptions {
  signal?: AbortSignal;
  onCatalog?: (progress: AppCompCatalogProgress) => void | Promise<void>;
  onSource?: (progress: CompSourceProgress) => void | Promise<void>;
  /** Keep audit/display writes alive without holding the dealer-facing response. */
  defer?: (work: () => Promise<void>) => void;
}

export class AppCompLookupError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * One implementation behind both the legacy JSON route and progressive NDJSON
 * route. Identity ambiguity and source fan-out deliberately overlap.
 */
export async function runAppCompLookup(
  inputSearchParams: URLSearchParams,
  options: AppCompLookupFlowOptions = {},
): Promise<AppCompReceipt> {
  const started = Date.now();
  const psaCert = readFirst(inputSearchParams, "psaCert", "cert", "psa");
  const psaLookup = psaCert ? new PsaCertLookup() : null;
  const psaResult = psaLookup ? await psaLookup.lookup(psaCert!) : null;
  if (psaResult && !psaResult.found && !hasCardIdentity(inputSearchParams)) {
    throw new AppCompLookupError(psaResult.reason ?? "PSA cert lookup failed", 400);
  }
  if (psaResult?.found && !isPsaPokemonTcgCert(psaResult)) {
    throw new AppCompLookupError(
      "That PSA cert is not a Pokémon TCG card, so it cannot feed Pokémon comps.",
      400,
    );
  }

  const effectiveSearchParams = psaResult?.found
    ? buildPsaCompSearchParams(inputSearchParams, psaResult)
    : inputSearchParams;
  const lookup = readCompLookupRequest(effectiveSearchParams);
  if ("error" in lookup) throw new AppCompLookupError(lookup.error, 400);
  const { card, grade } = lookup;

  const catalogSource = new PokemonTcgApiCatalogSource();
  const catalog = await resolveCatalogCard(card, catalogSource, { timeoutMs: CATALOG_RESOLVE_TIMEOUT_MS });
  const compCard = catalog ? catalogToCardRef(catalog, card) : card;
  const compService = createAppCompService(catalogSource, catalog);
  const explicitIdentity = requestHasExplicitCardNumber(card) || Boolean(card.tcgApiId);

  await options.onCatalog?.({
    requested: card,
    identity: compCard,
    grade,
    catalog,
    ambiguity: explicitIdentity ? false : "pending",
    sources: compService.sourceSummaries,
  });

  // Start all independent work before awaiting ambiguity. A provisional bare
  // query is reconciled conservatively until sibling discovery completes.
  const ambiguityPromise = resolveAmbiguity(card, catalog, catalogSource, explicitIdentity);
  const askEvidencePromise = fetchEbayAskEvidence(compCard, {
    grade,
    signal: options.signal,
    timeoutMs: EBAY_ASK_TIMEOUT_MS,
  });
  const compPromise = compService.lookup(compCard, { grade }, {
    ambiguous: !explicitIdentity,
    signal: options.signal,
    onProgress: options.onSource,
  });
  const [{ ambiguous, alternatives: ambiguityAlternatives }, provisionalResult, askEvidence] = await Promise.all([
    ambiguityPromise,
    compPromise,
    askEvidencePromise,
  ]);
  const result = reconcileCompReceipt(provisionalResult, compCard, { grade }, { ambiguous });

  let alternatives: CatalogCard[] = [];
  const cardImage = resolveCompCardImage({ catalog, headline: result.headline, all: result.all });
  const responseCatalog = withResolvedDisplayImage(catalog, cardImage);
  const needsRecovery = !catalog || !result.headline || result.headline.sampleSize === 0 || result.headline.medianPence <= 0;
  if (needsRecovery) {
    const recovery = await findCatalogAlternatives(card, catalogSource, 4, {
      timeoutMs: RECOVERY_ALTERNATIVES_TIMEOUT_MS,
    });
    alternatives = dedupeCatalogCards([...ambiguityAlternatives, ...recovery]).slice(0, 8);
  } else if (ambiguous) {
    alternatives = ambiguityAlternatives;
  }

  const receipt: AppCompReceipt = {
    ...attachAskEvidence(result, askEvidence),
    catalog: responseCatalog,
    alternatives,
    ambiguous,
    psaCert: psaResult,
    cardImage,
  };

  const persistEvidence = async () => {
    const writes: Promise<unknown>[] = [];
    if (cardImage.imageUrl && !cardImage.listingSafe) {
      writes.push(persistResolvedDisplayImage({
        card: compCard,
        catalog: responseCatalog,
        cardImage,
        catalogSource: responseCatalog ? fixedCatalogSource(catalogSource.live, responseCatalog) : null,
      }).catch((err) => {
        console.warn("[comps] card display image persistence skipped:", safeError(err));
      }));
    }
    if (process.env.DATABASE_URL && result.headline) {
      writes.push(new PrismaCompResultRepo().create(result.headline, {
        reconciliation: result.reconciliation,
        receipt: {
          all: result.all,
          unavailableSources: result.unavailableSources,
          sourcesDisagree: result.sourcesDisagree,
          cached: result.cached,
          ambiguous,
        },
      }).catch((err) => {
        console.warn("[comps] comp persistence skipped:", safeError(err));
      }));
    }
    await Promise.all(writes);
  };
  if (options.defer) options.defer(persistEvidence);
  else await persistEvidence();

  console.info(JSON.stringify({
    event: "comp_lookup_verdict",
    latencyMs: Date.now() - started,
    sourceCount: result.all.length,
    pricedSourceCount: new Set(result.all.filter((row) => row.sampleSize > 0 && row.medianPence > 0).map((row) => row.source)).size,
    confidence: result.reconciliation?.confidence ?? "none",
    manualCheck: result.reconciliation?.manualCheck ?? true,
    ambiguous,
    cached: Boolean(result.cached),
  }));
  return receipt;
}

async function resolveAmbiguity(
  card: CardRef,
  catalog: CatalogCard | null,
  catalogSource: PokemonTcgApiCatalogSource,
  explicitIdentity: boolean,
): Promise<{ ambiguous: boolean; alternatives: CatalogCard[] }> {
  if (explicitIdentity) return { ambiguous: false, alternatives: [] };
  const candidates = await findAmbiguousCatalogCandidates(card, catalogSource, 8, {
    timeoutMs: RECOVERY_ALTERNATIVES_TIMEOUT_MS,
  });
  let state = resolveBareSetAmbiguity(card, catalog, candidates);
  if (state.ambiguous && state.alternatives.length < MIN_AMBIGUOUS_ALTERNATIVES) {
    const expanded = await findAmbiguousCatalogCandidates(card, catalogSource, 12, { timeoutMs: 10_000 });
    state = resolveBareSetAmbiguity(card, catalog, expanded);
  }
  return state;
}

function readFirst(searchParams: URLSearchParams, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = searchParams.get(key)?.trim();
    if (!raw) continue;
    const normalized = raw.toLowerCase();
    if (["undefined", "null", "none", "n/a"].includes(normalized)) continue;
    return raw;
  }
  return undefined;
}

function hasCardIdentity(searchParams: URLSearchParams): boolean {
  return Boolean(readFirst(searchParams, "q", "query", "search", "name", "cardName", "card"));
}

function catalogIdentityKey(card: CatalogCard): string {
  return card.tcgApiId ?? card.tcgDexId ?? [
    card.name.trim().toLowerCase(),
    card.setName.trim().toLowerCase(),
    (card.number ?? "").trim().toLowerCase(),
  ].join("|");
}

function dedupeCatalogCards(cards: CatalogCard[]): CatalogCard[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = catalogIdentityKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
