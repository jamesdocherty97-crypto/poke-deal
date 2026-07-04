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
  const fx = await getFxHealth();
  const webhookReady = alertWebhookConfigured();
  const cronRuns = process.env.DATABASE_URL?.trim()
    ? await getPrisma().cronRun.findMany({
        orderBy: { startedAt: "desc" },
        take: 20,
      })
    : [];
  const lastSnapshot = latestSuccessfulRun(cronRuns, "daily-portfolio-snapshot");
  const lastWatchCheck = latestSuccessfulRun(cronRuns, "daily-buy-watch-check");
  const lastReprice = latestSuccessfulRun(cronRuns, "weekly-stock-health-reprice");

  const sources: SystemSource[] = [
    {
      id: "pokemon-price-tracker",
      label: "Price Tracker",
      role: "eBay sold comps",
      status: priceTracker.live ? "ready" : "fixture",
      required: true,
      setupHint: priceTracker.live
        ? "Primary sold-price source is live."
        : "Add POKEMON_PRICE_TRACKER_API_KEY in Vercel before relying on live buys.",
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
      role: "EU-first RAW cross-check",
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
            : "Add POKETRACE_API_KEY in Vercel for EU/Cardmarket and US cross-checks.",
    },
    {
      id: "ebay-marketplace-insights",
      label: "eBay Marketplace Insights",
      role: "UK eBay sold comps",
      status: ebayMi.live ? "ready" : "info",
      required: false,
      setupHint: ebayMi.live
        ? "Programmatic UK eBay sold comps are enabled. If lookups still return authorization errors, eBay has not granted the restricted MI access yet."
        : "Awaiting eBay approval - program currently closed to new applicants; support ticket pending. Code is ready; enable EBAY_MARKETPLACE_INSIGHTS_ENABLED=true on approval.",
    },
    {
      id: "psa-public-api",
      label: "PSA cert lookup",
      role: "graded slab verification + population",
      status: psa.live ? "ready" : "fixture",
      required: false,
      setupHint: psa.live
        ? "Live PSA cert verification is available (100 lookups/day on the free tier)."
        : "Add PSA_API_TOKEN in Vercel for live cert lookups. Runs on a demo cert until then.",
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
    sources,
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
    },
  });
}
