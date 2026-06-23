import { NextResponse } from "next/server";
import { PokemonTcgApiCatalogSource } from "@/lib/catalog/pokemonTcgApi";
import { PokeTraceSource } from "@/lib/comps/sources/pokeTrace";
import { PokemonPriceTrackerSource } from "@/lib/comps/sources/pokemonPriceTracker";

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
      role: "EU-first secondary cross-check",
      status: pokeTrace.live ? "ready" : "missing",
      required: false,
      setupHint: pokeTrace.live
        ? "EU/Cardmarket and US PokeTrace signals are available for raw-noise checks."
        : "Add POKETRACE_API_KEY in Vercel for EU/Cardmarket and US cross-checks.",
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
      id: "discord",
      label: "Discord",
      role: "price and reprice alerts",
      status: process.env.DISCORD_WEBHOOK_URL?.trim() ? "ready" : "missing",
      required: false,
      setupHint: process.env.DISCORD_WEBHOOK_URL?.trim()
        ? "Alert delivery is ready for buy targets and repricing."
        : "Add DISCORD_WEBHOOK_URL in Vercel for push-style alerts.",
    },
  ];

  return NextResponse.json({
    sources,
    summary: {
      livePrimaryComps: priceTracker.live,
      liveCatalogKey: catalog.live,
      secondaryCrossCheck: pokeTrace.live,
      alertDelivery: Boolean(process.env.DISCORD_WEBHOOK_URL?.trim()),
      storedSales: Boolean(process.env.DATABASE_URL?.trim()),
    },
  });
}
