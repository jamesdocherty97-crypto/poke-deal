import { getPrisma } from "../db/prisma.js";
import type { CardRef } from "../domain/types.js";
import { PokemonTcgApiCatalogSource } from "../catalog/pokemonTcgApi.js";
import { getFxHealth } from "../comps/currency.js";
import { EbayMarketplaceInsightsSource } from "../comps/sources/ebayMarketplaceInsights.js";
import { getPokeTraceHealth, PokeTraceSource } from "../comps/sources/pokeTrace.js";
import { PokemonPriceTrackerSource } from "../comps/sources/pokemonPriceTracker.js";
import { fetchEbayAskEvidence } from "../ebay/browseAsks.js";
import { getEbayConfig } from "../ebay/config.js";
import { resolveEbayRefreshToken } from "../ebay/credentials.js";
import { fetchEbayPolicies } from "../ebay/policies.js";
import { getAccessTokenWithSource } from "../ebay/tokens.js";
import { PsaCertLookup } from "../psa/psaCert.js";
import { readSourceFreshness, recordSourceSuccess } from "./sourceFreshness.js";

export type DeepHealthStatus = "ok" | "fail" | "skipped";

export type DeepHealthSource = {
  id: string;
  label: string;
  role: string;
  required: boolean;
  status: DeepHealthStatus;
  latencyMs: number;
  detail: string;
  checkedAt: string;
  lastSuccessAt: string | null;
  freshnessSeconds: number | null;
};

export type DeepHealthReport = {
  checkedAt: string;
  sources: DeepHealthSource[];
};

type HealthProbe = {
  id: string;
  label: string;
  role: string;
  required: boolean;
  run: () => Promise<string | { status: DeepHealthStatus; detail: string }>;
};

const HEALTH_CARD: CardRef = {
  game: "POKEMON",
  name: "Charizard ex",
  setName: "151",
  number: "199/165",
  language: "EN",
};

export async function runDeepHealthCheck(now = new Date()): Promise<DeepHealthReport> {
  const checkedAt = now.toISOString();
  const probes: HealthProbe[] = [
    {
      id: "pokemon-price-tracker",
      label: "Price Tracker",
      role: "eBay sold comps",
      required: true,
      run: async () => {
        const source = new PokemonPriceTrackerSource();
        if (!source.live) return { status: "skipped", detail: "No key; fixture mode." };
        const comp = await source.lookup(HEALTH_CARD, { grade: "PSA_10", windowDays: 30 });
        return comp.sampleSize > 0
          ? `PSA 10 sample ${comp.sampleSize}, median £${(comp.medianPence / 100).toFixed(2)}.`
          : { status: "fail", detail: comp.raw && typeof comp.raw === "object" && "reason" in comp.raw ? String(comp.raw.reason) : "No sample returned." };
      },
    },
    {
      id: "poketrace",
      label: "PokeTrace",
      role: "RAW cross-check",
      required: false,
      run: async () => {
        const source = new PokeTraceSource();
        if (!source.live) return { status: "skipped", detail: "No key configured." };
        const health = getPokeTraceHealth();
        if (health.inCooldown || health.persistentKeyProblem) {
          return {
            status: "skipped",
            detail: health.persistentKeyProblem
              ? "Key/account problem in cooldown."
              : `Cooling down until ${health.cooldownUntil}.`,
          };
        }
        const comp = await source.lookup(HEALTH_CARD, { grade: "RAW", windowDays: 30 });
        return comp.sampleSize > 0
          ? `RAW signal ${comp.sampleSize}, median £${(comp.medianPence / 100).toFixed(2)}.`
          : { status: "fail", detail: comp.raw && typeof comp.raw === "object" && "reason" in comp.raw ? String(comp.raw.reason) : "No usable signal." };
      },
    },
    {
      id: "pokemon-tcg-api",
      label: "Pokemon TCG API",
      role: "catalog and art",
      required: true,
      run: async () => {
        const source = new PokemonTcgApiCatalogSource();
        const card = await source.resolve(HEALTH_CARD);
        return card?.imageUrl
          ? `${card.name} ${card.number ?? ""} resolved with art.`
          : { status: "fail", detail: source.live ? "Live API did not resolve the health card." : "Public/fixture lookup did not resolve the health card." };
      },
    },
    {
      id: "psa-public-api",
      label: "PSA cert lookup",
      role: "slab verification",
      required: false,
      run: async () => {
        const lookup = new PsaCertLookup();
        const cert = process.env.HEALTH_PSA_CERT?.trim() || "84213567";
        const result = await lookup.lookup(cert);
        if (!lookup.live) return { status: "skipped", detail: "No PSA token; fixture lookup available." };
        return result.found
          ? `Cert ${result.certNumber} ${result.gradeLabel ?? ""} resolved.`
          : { status: "fail", detail: result.reason ?? "PSA returned no cert data." };
      },
    },
    {
      id: "fx-rates",
      label: "FX rates",
      role: "foreign currency to GBP",
      required: false,
      run: async () => {
        const fx = await getFxHealth({ forceRefresh: true });
        return fx.source === "static"
          ? { status: "skipped", detail: "Using static FX fallback." }
          : `${fx.source} ${fx.provider}, as of ${fx.asOf}.`;
      },
    },
    {
      id: "ebay-browse",
      label: "eBay Browse asks",
      role: "UK active ask check",
      required: false,
      run: async () => {
        const evidence = await fetchEbayAskEvidence(HEALTH_CARD, { grade: "PSA_10", limit: 1 });
        if (evidence.skipped) return { status: "skipped", detail: evidence.reason ?? "Browse lookup skipped." };
        return evidence.count > 0
          ? `${evidence.count} UK ask listing${evidence.count === 1 ? "" : "s"} returned.`
          : "Browse API reachable; no listings survived the relevance filters for the health card.";
      },
    },
    {
      id: "ebay-sell-api",
      label: "eBay Sell API",
      role: "listing automation",
      required: false,
      run: async () => {
        const config = getEbayConfig();
        if (!config) return { status: "skipped", detail: "eBay app credentials not configured." };
        const refreshToken = await resolveEbayRefreshToken();
        if (!refreshToken) return { status: "skipped", detail: "No seller OAuth refresh token stored." };
        const token = await getAccessTokenWithSource(config, fetch, { refreshToken });
        const policies = await fetchEbayPolicies(config, token.accessToken);
        return policies.paymentPolicyId && policies.fulfillmentPolicyId && policies.returnPolicyId
          ? `Token source ${token.tokenSource}; policies ready.`
          : { status: "fail", detail: `Token source ${token.tokenSource}; policies incomplete.` };
      },
    },
    {
      id: "ebay-marketplace-insights",
      label: "eBay Marketplace Insights",
      role: "UK sold comps",
      required: false,
      run: async () => {
        const source = new EbayMarketplaceInsightsSource();
        if (!source.live) return { status: "skipped", detail: "Restricted MI access not enabled." };
        const comp = await source.lookup(HEALTH_CARD, { grade: "PSA_10", windowDays: 30 });
        return comp.sampleSize > 0
          ? `UK sold sample ${comp.sampleSize}, median £${(comp.medianPence / 100).toFixed(2)}.`
          : { status: "fail", detail: comp.raw && typeof comp.raw === "object" && "reason" in comp.raw ? String(comp.raw.reason) : "No UK sold sample." };
      },
    },
    {
      id: "database",
      label: "Neon database",
      role: "stock, sales, settings",
      required: true,
      run: async () => {
        if (!process.env.DATABASE_URL?.trim()) return { status: "fail", detail: "DATABASE_URL is missing." };
        const db = getPrisma();
        const count = await db.inventoryItem.count();
        return `${count} inventory row${count === 1 ? "" : "s"} reachable.`;
      },
    },
    {
      id: "blob",
      label: "Blob storage",
      role: "listing photos",
      required: false,
      run: async () => {
        if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) return { status: "skipped", detail: "Blob token missing; photo uploads will use remote URLs/catalog art only." };
        const { list } = await import("@vercel/blob");
        const result = await list({ limit: 1 });
        return `${result.blobs.length} blob${result.blobs.length === 1 ? "" : "s"} sampled.`;
      },
    },
  ];

  const sources = await Promise.all(probes.map((probe) => runProbe(probe, checkedAt)));
  return { checkedAt, sources };
}

async function runProbe(probe: HealthProbe, checkedAt: string): Promise<DeepHealthSource> {
  const started = Date.now();
  try {
    const outcome = await withTimeout(probe.run(), 12_000, `${probe.label} timed out.`);
    const latencyMs = Date.now() - started;
    if (typeof outcome === "string") {
      recordSourceSuccess(probe.id, new Date(checkedAt));
      return { ...probeBase(probe, checkedAt, latencyMs), status: "ok", detail: outcome };
    }
    if (outcome.status === "ok") recordSourceSuccess(probe.id, new Date(checkedAt));
    return { ...probeBase(probe, checkedAt, latencyMs), status: outcome.status, detail: outcome.detail };
  } catch (err) {
    return {
      ...probeBase(probe, checkedAt, Date.now() - started),
      status: "fail",
      detail: err instanceof Error ? err.message : `${probe.label} failed.`,
    };
  }
}

function probeBase(probe: HealthProbe, checkedAt: string, latencyMs: number) {
  const freshness = readSourceFreshness(probe.id, new Date(checkedAt));
  return {
    id: probe.id,
    label: probe.label,
    role: probe.role,
    required: probe.required,
    latencyMs,
    checkedAt,
    ...freshness,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
