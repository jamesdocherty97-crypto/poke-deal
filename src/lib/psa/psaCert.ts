// PSA Public API cert-lookup adapter.
//
// Endpoint: GET https://api.psacard.com/publicapi/cert/GetByCertNumber/{certNo}
// Auth:     Authorization: bearer <PSA_API_TOKEN>
// Envelope: { IsValidRequest: bool, ServerMessage: string, PSACert: {...}, DNACert?: {...} }
//
// Missing credentials return explicit unavailable evidence. Captured fixtures are
// used only by tests and never substitute for a requested cert.
// Never throws: failures degrade to { found:false, reason }.

import type { PsaCertResult } from "./types.js";
import { psaGradeLabelToGrade } from "./types.js";
import { fetchReadWithRetry } from "../http/fetchReadWithRetry.js";

const BASE_URL = "https://api.psacard.com/publicapi";
const DEFAULT_FETCH_TIMEOUT_MS = 6000;
const SUCCESS_CACHE_TTL_MS = 60 * 60 * 1000;
const NOT_FOUND_CACHE_TTL_MS = 5 * 60 * 1000;
const certCache = new Map<string, { result: PsaCertResult; cachedAt: number; expiresAt: number }>();
const fetchIds = new WeakMap<typeof fetch, number>();
let nextFetchId = 1;

export class PsaCertLookup {
  readonly name = "psa-public-api";
  readonly live: boolean;

  constructor(
    private readonly token: string | undefined = process.env.PSA_API_TOKEN,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  ) {
    this.live = Boolean(token && token.trim().length > 0);
  }

  async lookup(certNumber: string): Promise<PsaCertResult> {
    const cert = sanitizeCertNumber(certNumber);
    if (!cert) {
      return notFound("", false, "Enter a numeric PSA cert number");
    }

    if (!this.live) {
      return notFound(cert, false, "PSA API token missing");
    }

    const cacheKey = `${fetchId(this.fetchImpl)}|${cert}`;
    const cached = readCertCache(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetchReadWithRetry(this.fetchImpl, `${BASE_URL}/cert/GetByCertNumber/${cert}`, {
        headers: { Authorization: `bearer ${this.token}`, Accept: "application/json" },
        signal: timeoutSignal(this.fetchTimeoutMs),
      }, { totalDeadlineMs: this.fetchTimeoutMs });

      if (res.status === 204) return writeCertCache(cacheKey, notFound(cert, true, "PSA returned no cert data (empty request)"), NOT_FOUND_CACHE_TTL_MS);
      if (res.status === 500) return notFound(cert, true, "PSA rejected the request (often invalid credentials)");
      if (!res.ok) return notFound(cert, true, describePsaHttpFailure(res));

      const json = (await res.json()) as unknown;
      const mapped = mapPsaCertResponse(json, cert, true);
      return writeCertCache(cacheKey, mapped, mapped.found ? SUCCESS_CACHE_TTL_MS : NOT_FOUND_CACHE_TTL_MS);
    } catch (err) {
      return notFound(cert, true, `PSA lookup failed: ${(err as Error).message}`);
    }
  }
}

function describePsaHttpFailure(response: Response): string {
  const server = response.headers.get("server")?.toLowerCase() ?? "";
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const cloudflare = server.includes("cloudflare") || response.headers.has("cf-ray");
  if (response.status === 403 && (cloudflare || contentType.includes("text/html"))) {
    return "PSA blocked this network before token validation (Cloudflare HTTP 403)";
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after")?.trim();
    return `PSA rate limited the lookup (HTTP 429${retryAfter ? `; retry after ${retryAfter}` : ""})`;
  }
  return `PSA HTTP ${response.status}`;
}

type PsaCertObject = Record<string, unknown>;

/** Pure mapper from the PSA envelope to a normalized result. Exported for tests. */
export function mapPsaCertResponse(json: unknown, certNumber: string, live: boolean): PsaCertResult {
  const envelope = (json ?? {}) as Record<string, unknown>;
  const isValid = readBool(envelope.IsValidRequest ?? envelope.isValidRequest);
  const serverMessage = readString(envelope.ServerMessage ?? envelope.serverMessage);

  if (isValid === false) {
    return notFound(certNumber, live, serverMessage ?? "Invalid cert number");
  }

  const cert = (envelope.PSACert ?? envelope.psaCert ?? envelope.PsaCert) as PsaCertObject | undefined;
  if (!cert || typeof cert !== "object") {
    return notFound(certNumber, live, serverMessage ?? "No data found for this cert");
  }

  const gradeLabel = readString(get(cert, "CardGrade")) ?? readString(get(cert, "GradeDescription"));

  return {
    found: true,
    certNumber: readString(get(cert, "CertNumber")) ?? certNumber,
    subject: readString(get(cert, "Subject")),
    brand: readString(get(cert, "Brand")),
    category: readString(get(cert, "Category")),
    year: readString(get(cert, "Year")),
    cardNumber: readString(get(cert, "CardNumber")),
    variety: readString(get(cert, "Variety")),
    gradeLabel,
    grade: psaGradeLabelToGrade(gradeLabel),
    totalPopulation: readNumber(get(cert, "TotalPopulation")),
    populationHigher: readNumber(get(cert, "PopulationHigher")),
    isDualCert: readBool(get(cert, "IsDualCert")) ?? false,
    live,
    raw: cert,
    checkedAt: new Date().toISOString(),
  };
}

function notFound(certNumber: string, live: boolean, reason: string): PsaCertResult {
  return { found: false, certNumber, grade: null, live, reason, checkedAt: new Date().toISOString() };
}

function readCertCache(key: string): PsaCertResult | null {
  const entry = certCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    certCache.delete(key);
    return null;
  }
  return {
    ...entry.result,
    live: false,
    cached: true,
    cacheAgeMinutes: Math.max(0, Math.floor((Date.now() - entry.cachedAt) / 60_000)),
  };
}

function writeCertCache(key: string, result: PsaCertResult, ttlMs: number): PsaCertResult {
  const cachedAt = Date.now();
  certCache.set(key, { result, cachedAt, expiresAt: cachedAt + ttlMs });
  return result;
}

export function resetPsaCertCacheForTests(): void {
  certCache.clear();
}

function fetchId(fetchImpl: typeof fetch): number {
  const existing = fetchIds.get(fetchImpl);
  if (existing) return existing;
  const id = nextFetchId++;
  fetchIds.set(fetchImpl, id);
  return id;
}

function sanitizeCertNumber(value: string | undefined): string | null {
  const digits = (value ?? "").trim().replace(/[^0-9]/g, "");
  return digits.length > 0 ? digits : null;
}

function get(obj: PsaCertObject, key: string): unknown {
  if (key in obj) return obj[key];
  // Be tolerant of casing variations.
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) return obj[k];
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
}
