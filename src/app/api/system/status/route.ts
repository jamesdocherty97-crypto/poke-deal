import { NextResponse } from "next/server";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import { getPokeTraceHealth, PokeTraceSource } from "@/lib/comps/sources/pokeTrace";
import { EbayMarketplaceInsightsSource } from "@/lib/comps/sources/ebayMarketplaceInsights";
import { latestSuccessfulRun } from "@/lib/automation/cronRunLog";
import { alertWebhookConfigured } from "@/lib/alerts/notifier";
import { getPrisma } from "@/lib/db/prisma";
import { PokemonPriceTrackerSource } from "@/lib/comps/sources/pokemonPriceTracker";
import { PsaCertLookup } from "@/lib/psa/psaCert";
import { getFxHealth } from "@/lib/comps/currency";
import { readSourceFreshness } from "@/lib/system/sourceFreshness";
import { getEbayConfig } from "@/lib/ebay/config";
import { resolveEbayRefreshToken } from "@/lib/ebay/credentials";
import { accountDeletionVerificationToken } from "@/lib/ebay/accountDeletion";
import { readScanEvaluation, type ScanEvaluationDb } from "@/lib/scan/scanEvaluation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SystemSource = {
  id: string;
  label: string;
  role: string;
  status: "ready" | "public" | "fixture" | "missing" | "building" | "problem" | "info";
  required: boolean;
  setupHint?: string;
};

export async function GET() {
  const priceTracker = new PokemonPriceTrackerSource();
  const catalog = new PokemonTcgApiCatalogSource();
  const pokeTrace = new PokeTraceSource();
  const pokeTraceHealth = getPokeTraceHealth();
  const ebayMi = new EbayMarketplaceInsightsSource();
  const psa = new PsaCertLookup();
  const webhookReady = alertWebhookConfigured();
  const ebayConfig = getEbayConfig();
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
  const deletionTokenConfigured = Boolean(accountDeletionVerificationToken());
  const databaseReady = Boolean(process.env.DATABASE_URL?.trim());
  const [fx, ebayRefreshToken, scanEvaluation, cronRuns] = await Promise.all([
    getFxHealth(),
    ebayConfig ? resolveEbayRefreshToken().catch(() => null) : Promise.resolve(null),
    databaseReady
      ? readScanEvaluation(getPrisma() as unknown as ScanEvaluationDb).catch(() => null)
      : Promise.resolve(null),
    databaseReady
      ? getPrisma().cronRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 })
      : Promise.resolve([]),
  ]);
  const lastSnapshot = latestSuccessfulRun(cronRuns, "daily-portfolio-snapshot");
  const lastWatchCheck = latestSuccessfulRun(cronRuns, "daily-buy-watch-check");
  const lastReprice = latestSuccessfulRun(cronRuns, "weekly-stock-health-reprice");

  const sources: SystemSource[] = [
    {
      id: "pokemon-price-tracker",
      label: "Price Tracker",
      role: "eBay sold comps",
      status: priceTracker.live ? "ready" : "missing",
      required: true,
      setupHint: priceTracker.live
        ? "Primary sold-price source is live."
        : "Add POKEMON_PRICE_TRACKER_API_KEY in Vercel before relying on live buys.",
    },
    {
      id: "tcgdex",
      label: "TCGdex",
      role: "fallback catalog and art",
      status: "public",
      required: false,
      setupHint: "Public fallback is implemented; deep health proves whether it currently resolves live data.",
    },
    {
      id: "pokemon-tcg-api",
      label: "Pokemon TCG API",
      role: "catalog, art, market baseline",
      status: catalog.live ? "ready" : "public",
      required: true,
      setupHint: catalog.live
        ? "Catalog search, card art and market baselines are live."
        : "Add POKEMON_TCG_API_KEY in Vercel for stronger card matching and images.",
    },
    {
      id: "poketrace",
      label: "PokeTrace",
      role: "US RAW cross-check; optional entitled EU",
      status: pokeTraceHealth.persistentKeyProblem
        ? "problem"
        : pokeTrace.live && pokeTraceHealth.inCooldown
          ? "building"
          : pokeTrace.live
            ? "ready"
            : "missing",
      required: false,
      setupHint: pokeTraceHealth.persistentKeyProblem
        ? "PokeTrace is returning 403 after cooldown. Check the key, account tier or dashboard access."
        : pokeTrace.live && pokeTraceHealth.inCooldown
          ? `PokeTrace is cooling down after ${pokeTraceHealth.cooldownReason === "rate-limit" ? "rate limits" : "authorization errors"} until ${pokeTraceHealth.cooldownUntil}.`
          : pokeTrace.live
            ? `PokeTrace is configured for RAW cross-checks.${pokeTraceHealth.deniedMarkets.length > 0 ? ` Skipping plan-gated markets: ${pokeTraceHealth.deniedMarkets.map((item) => item.market).join(", ")}.` : ""} Graded coverage depends on account tier and source data.`
            : "Add POKETRACE_API_KEY in Vercel for the private-use US RAW cross-check.",
    },
    {
      id: "ebay-marketplace-insights",
      label: "eBay Marketplace Insights",
      role: "UK eBay sold comps",
      status: ebayMi.live ? "ready" : "info",
      required: false,
      setupHint: ebayMi.live
        ? "Programmatic UK eBay sold comps are enabled. If lookups still return authorization errors, eBay has not granted the restricted MI access yet."
        : "Awaiting eBay approval — program currently closed to new applicants; support ticket pending. Code is ready; enable EBAY_MARKETPLACE_INSIGHTS_ENABLED=true on approval.",
    },
    {
      id: "psa-public-api",
      label: "PSA cert lookup",
      role: "graded slab verification + population",
      status: psa.live ? "ready" : "missing",
      required: false,
      setupHint: psa.live
        ? "PSA credentials are configured; deep health proves current lookup availability."
        : "Add PSA_API_TOKEN in Vercel for live cert lookups; no fixture identity is substituted.",
    },
    {
      id: "gemini",
      label: "Gemini",
      role: "card image OCR",
      status: geminiConfigured ? "building" : "missing",
      required: false,
      setupHint: geminiConfigured
        ? scanEvaluation?.total
          ? `Last ${scanEvaluation.periodDays}d: ${scanEvaluation.readableRatePct ?? 0}% readable, ${scanEvaluation.correctionRatePct ?? 0}% dealer-corrected, p95 ${scanEvaluation.latencyMs.p95 ?? "—"}ms across ${scanEvaluation.total} scans.`
          : "Key is configured; no measured scans yet. Run a card scan to start quality and latency tracking."
        : "Add GEMINI_API_KEY to enable scan-to-comp.",
    },
    {
      id: "ebay-browse",
      label: "eBay Browse",
      role: "UK active asks",
      status: ebayConfig ? "building" : "missing",
      required: false,
      setupHint: ebayConfig
        ? "App credentials are configured; deep health proves live Browse responses and filtering."
        : "Add eBay application credentials for active asks.",
    },
    {
      id: "ebay-sell-api",
      label: "eBay Sell",
      role: "listing and order automation",
      status: ebayRefreshToken ? "building" : "missing",
      required: false,
      setupHint: ebayRefreshToken
        ? "A refresh token is stored; deep health proves current authentication and policy access."
        : "Connect the seller account through /api/ebay/connect.",
    },
    {
      id: "ebay-account-deletion",
      label: "eBay account deletion",
      role: "marketplace privacy compliance",
      status: deletionTokenConfigured ? "building" : "missing",
      required: false,
      setupHint: deletionTokenConfigured
        ? "Callback token is configured; dashboard subscription/exemption and signed delivery still require verification."
        : "Configure the dashboard callback/token or confirm an eBay exemption.",
    },
    {
      id: "blob",
      label: "Vercel Blob",
      role: "inventory photos",
      status: blobConfigured ? "building" : "missing",
      required: false,
      setupHint: blobConfigured
        ? "Blob credentials are configured; deep health proves store access."
        : "Add BLOB_READ_WRITE_TOKEN to enable owned photo uploads and deletion.",
    },
    {
      id: "fx-rates",
      label: "FX rates",
      role: "USD/EUR/JPY to GBP",
      status: fx.source === "static" ? "building" : "ready",
      required: false,
      setupHint:
        fx.source === "static"
          ? "Using static FX fallback. Add FX_API_KEY for daily cached live conversion."
          : `${fx.source === "live" ? "Live" : "Cached"} rates from ${fx.provider}, ${fx.ageDays && fx.ageDays > 0 ? `${fx.ageDays}d old` : "fresh"}.`,
    },
    {
      id: "owned-sales",
      label: "Owned sales",
      role: "James's real sale history",
      status: process.env.DATABASE_URL?.trim() ? "building" : "missing",
      required: true,
      setupHint: process.env.DATABASE_URL?.trim()
        ? "Starts improving comps after your first few booked sales."
        : "Add DATABASE_URL in Vercel so stock and sales persist.",
    },
    {
      id: "ledger-backups",
      label: "Backups",
      role: "ledger export + restore",
      status: process.env.DATABASE_URL?.trim() ? "building" : "missing",
      required: true,
      setupHint: process.env.DATABASE_URL?.trim()
        ? "Download/manual backups are available. Neon PITR depends on the project restore window; backups: manual only until that is confirmed in Neon."
        : "Add DATABASE_URL before backup exports can read the ledger.",
    },
    {
      id: "push-alerts",
      label: "Alert webhook",
      role: "price and reprice alerts",
      status: webhookReady ? "ready" : "missing",
      required: false,
      setupHint: webhookReady
        ? "Off-app alert delivery is ready for buy targets and repricing."
        : "Off-app delivery is off; buy targets, reprices and cron failures still stay in the app inbox.",
    },
    {
      id: "automation",
      label: "Automation",
      role: "daily snapshot + weekly reprice",
      status: lastSnapshot || lastWatchCheck || lastReprice ? "ready" : "building",
      required: true,
      setupHint: [
        lastSnapshot ? `Last snapshot: ${lastSnapshot.startedAt.toISOString()}.` : "Last snapshot: not run yet.",
        lastWatchCheck ? `Last buy-watch check: ${lastWatchCheck.startedAt.toISOString()}.` : "Last buy-watch check: not run yet.",
        lastReprice ? `Last weekly reprice: ${lastReprice.startedAt.toISOString()}.` : "Last weekly reprice: not run yet.",
      ].join(" "),
    },
  ];

  return NextResponse.json({
    sources: sources.map((source) => ({ ...source, ...readSourceFreshness(source.id) })),
    summary: {
      livePrimaryComps: priceTracker.live,
      liveCatalogKey: catalog.live,
      secondaryCrossCheck: pokeTrace.live && !pokeTraceHealth.persistentKeyProblem,
      ebayMarketplaceInsights: ebayMi.live,
      psaCertLookup: psa.live,
      fxRates: fx,
      alertDelivery: webhookReady,
      storedSales: Boolean(process.env.DATABASE_URL?.trim()),
      manualBackups: Boolean(process.env.DATABASE_URL?.trim()),
      lastSnapshotAt: lastSnapshot?.startedAt.toISOString() ?? null,
      lastWatchCheckAt: lastWatchCheck?.startedAt.toISOString() ?? null,
      lastRepriceAt: lastReprice?.startedAt.toISOString() ?? null,
      scanEvaluation,
    },
  });
}
