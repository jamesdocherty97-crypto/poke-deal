// PSA Public API cert-lookup adapter.
//
// Endpoint: GET https://api.psacard.com/publicapi/cert/GetByCertNumber/{certNo}
// Auth:     Authorization: bearer <PSA_API_TOKEN>   (free tier: 100 calls/day)
// Envelope: { IsValidRequest: bool, ServerMessage: string, PSACert: {...}, DNACert?: {...} }
//
// Two modes, mirroring the comp sources:
//   • FIXTURE (no token) → returns a bundled sample cert so the UI flow works offline.
//   • LIVE   (token present) → calls the API and maps the PSACert object.
// Never throws: failures degrade to { found:false, reason }.

import type { PsaCertResult } from "./types.js";
import { psaGradeLabelToGrade } from "./types.js";

const BASE_URL = "https://api.psacard.com/publicapi";
const DEFAULT_FETCH_TIMEOUT_MS = 6000;

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
      // Offline: serve a representative fixture so the flow is demoable without a token.
      return { ...fixtureCert(cert), live: false };
    }

    try {
      const res = await this.fetchImpl(`${BASE_URL}/cert/GetByCertNumber/${cert}`, {
        headers: { Authorization: `bearer ${this.token}`, Accept: "application/json" },
        signal: timeoutSignal(this.fetchTimeoutMs),
      });

      if (res.status === 204) return notFound(cert, true, "PSA returned no cert data (empty request)");
      if (res.status === 500) return notFound(cert, true, "PSA rejected the request (often invalid credentials)");
      if (!res.ok) return notFound(cert, true, `PSA HTTP ${res.status}`);

      const json = (await res.json()) as unknown;
      return mapPsaCertResponse(json, cert, true);
    } catch (err) {
      return notFound(cert, true, `PSA lookup failed: ${(err as Error).message}`);
    }
  }
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
  };
}

function notFound(certNumber: string, live: boolean, reason: string): PsaCertResult {
  return { found: false, certNumber, grade: null, live, reason };
}

/** Bundled sample so the cert flow demos offline. A real Umbreon VMAX alt-art slab shape. */
function fixtureCert(certNumber: string): PsaCertResult {
  return {
    found: true,
    certNumber,
    subject: "UMBREON VMAX",
    brand: "POKEMON SWORD & SHIELD EVOLVING SKIES",
    category: "TCG CARDS",
    year: "2021",
    cardNumber: "215",
    variety: "ALTERNATE ART SECRET",
    gradeLabel: "GEM MT 10",
    grade: "PSA_10",
    totalPopulation: 12863,
    populationHigher: 0,
    isDualCert: false,
    live: false,
    raw: { fixture: true },
  };
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
