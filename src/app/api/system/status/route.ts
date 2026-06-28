import { NextResponse } from "next/server";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import { PokeTraceSource } from "@/lib/comps/sources/pokeTrace";
import { EbayMarketplaceInsightsSource } from "@/lib/comps/sources/ebayMarketplaceInsights";
import { PokemonPriceTrackerSource } from "@/lib/comps/sources/pokemonPriceTracker";
import { getEbayConfig, hasEbayRefreshToken } from "@/lib/ebay/config";
import { PsaCertLookup } from "@/lib/psa/psaCert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SystemSource = {
  id: string;
  label: string;
  role: string;
  status: "ready" | "public" | "fixture" | "missing" | "building";
  required: boolean;
  setupHint?: string;
};

export async function GET() {
  const priceTracker = new PokemonPriceTrackerSource();
  const catalog = new PokemonTcgApiCatalogSource();
  const pokeTrace = new PokeTraceSource();
  const ebayMi = new EbayMarketplaceInsightsSource();
  const psa = new PsaCertLookup();
  const ebayConfigured = Boolean(getEbayConfig());
  const ebayConnected = hasEbayRefreshToken();
  const ebayMiEnabled = process.env.EBAY_MARKETPLACE_INSIGHTS_ENABLED?.trim().toLowerCase() === "true";

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
      status: pokeTrace.live ? "ready" : "missing",
      required: false,
      setupHint: pokeTrace.live
        ? "PokeTrace is configured for RAW cross-checks. Graded coverage depends on account tier and source data."
        : "Add POKETRACE_API_KEY in Vercel for EU/Cardmarket and US cross-checks.",
    },
    {
      id: "ebay-marketplace-insights",
      label: "eBay Marketplace Insights",
      role: "UK eBay sold comps",
      status: ebayMi.live ? "ready" : ebayMiEnabled && ebayConfigured && ebayConnected ? "building" : "missing",
      required: false,
      setupHint: ebayMi.live
        ? "Programmatic UK eBay sold comps are enabled. If lookups still return authorization errors, eBay has not granted the restricted MI access yet."
        : ebayMiEnabled
          ? "MI is enabled but needs eBay credentials, OAuth connection, and restricted Marketplace Insights approval before it can return live sold comps."
          : "Restricted eBay MI code is deployed but disabled. Set EBAY_MARKETPLACE_INSIGHTS_ENABLED=true after approval.",
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
      id: "push-alerts",
      label: "Push alerts",
      role: "price and reprice alerts",
      status: process.env.DISCORD_WEBHOOK_URL?.trim() ? "ready" : "missing",
      required: false,
      setupHint: process.env.DISCORD_WEBHOOK_URL?.trim()
        ? "Alert delivery is ready for buy targets and repricing."
        : "Push delivery is off; buy targets and reprices still stay in-app.",
    },
  ];

  return NextResponse.json({
    sources,
    summary: {
      livePrimaryComps: priceTracker.live,
      liveCatalogKey: catalog.live,
      secondaryCrossCheck: pokeTrace.live,
      ebayMarketplaceInsights: ebayMi.live,
      psaCertLookup: psa.live,
      alertDelivery: Boolean(process.env.DISCORD_WEBHOOK_URL?.trim()),
      storedSales: Boolean(process.env.DATABASE_URL?.trim()),
    },
  });
}
