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
    },
    {
      id: "pokemon-tcg-api",
      label: "Pokemon TCG API",
      role: "catalog, art, market baseline",
      status: catalog.live ? "ready" : "public",
      required: true,
    },
    {
      id: "poketrace",
      label: "PokeTrace",
      role: "secondary cross-check",
      status: pokeTrace.live ? "ready" : "missing",
      required: false,
    },
    {
      id: "owned-sales",
      label: "Owned sales",
      role: "James's real sale history",
      status: process.env.DATABASE_URL?.trim() ? "building" : "missing",
      required: true,
    },
    {
      id: "discord",
      label: "Discord",
      role: "price and reprice alerts",
      status: process.env.DISCORD_WEBHOOK_URL?.trim() ? "ready" : "missing",
      required: false,
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
