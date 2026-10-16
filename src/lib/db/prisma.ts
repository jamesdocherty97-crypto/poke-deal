import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * Hosted previews must never connect to the production database: every
 * preview request would wake it and could write to the live ledger. A preview
 * uses PREVIEW_DATABASE_URL (for example a Neon branch) and ignores
 * DATABASE_URL; without one it has no database. Production, local development
 * and tests keep using DATABASE_URL from schema.prisma.
 *
 * Returns the datasource URL override, or null to use DATABASE_URL.
 */
export function resolveDatasourceUrl(env: Record<string, string | undefined> = process.env): string | null {
  if (env.VERCEL_ENV?.trim().toLowerCase() !== "preview") return null;
  const previewUrl = env.PREVIEW_DATABASE_URL?.trim();
  if (!previewUrl) {
    throw new Error("Preview deployments do not use DATABASE_URL. Set a separate PREVIEW_DATABASE_URL to give previews a database.");
  }
  const productionHost = hostOf(env.DATABASE_URL);
  if (productionHost && hostOf(previewUrl) === productionHost) {
    throw new Error("PREVIEW_DATABASE_URL points at the same database host as DATABASE_URL; previews refuse it.");
  }
  return previewUrl;
}

export function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const datasourceUrl = resolveDatasourceUrl();
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(datasourceUrl ? { datasourceUrl } : {}),
  });

  // A serverless production isolate may serve many requests. Reuse the same
  // Prisma pool for the lifetime of that isolate instead of constructing a
  // fresh pool per request. Provider-side pooling is still recommended for
  // DATABASE_URL; this guards the application side of the connection budget.
  globalForPrisma.prisma = client;

  return client;
}

function hostOf(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    // Neon's pooled and direct hosts differ only by "-pooler" on the endpoint
    // label; both reach the same database, so compare them as one.
    return new URL(url.trim()).hostname.toLowerCase().replace(/^([^.]+)-pooler\./, "$1.") || null;
  } catch {
    return null;
  }
}
