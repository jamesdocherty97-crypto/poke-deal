import { NextResponse } from "next/server";
import { runDeepHealthCheck } from "@/lib/system/deepHealth";
import { createTtlCache } from "@/lib/system/ttlCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEALTH_TTL_MS = 60_000;

// The deep check probes the database and every provider. Repeats within a
// minute reuse the last report from this isolate instead of waking Neon and
// spending provider quota again; `checkedAt` shows when it actually ran.
const readHealth = createTtlCache(() => runDeepHealthCheck(), HEALTH_TTL_MS);

export async function GET() {
  // Server-side only: /api responses stay private, no-store (next.config.mjs).
  const { value: report, hit } = await readHealth();
  const hasRequiredFailure = report.sources.some((source) => source.required && source.status === "fail");
  return NextResponse.json(report, {
    status: hasRequiredFailure ? 503 : 200,
    headers: { "X-Health-Cache": hit ? "hit" : "miss" },
  });
}
