import { NextResponse } from "next/server";
import { runInventoryCompWarmup } from "@/lib/comps/warmCompRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const summary = await runInventoryCompWarmup({ limit: 100, concurrency: 2, timeoutMs: 15_000 });
    return NextResponse.json({
      scanned: summary.scanned,
      skipped: summary.skipped,
      refreshed: summary.refreshed,
      failed: summary.failed,
      failures: summary.failures.slice(0, 10),
      sourceStats: summary.sourceStats ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "comp warm-up failed" },
      { status: 500 },
    );
  }
}
