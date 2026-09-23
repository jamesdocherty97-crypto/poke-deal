import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db/prisma";
import { countEbayOrderImports, readEbayOrderImportQueue, syncOwnEbaySales } from "@/lib/ebay/orders";
import { ebayApiErrorResponseBody, ebayErrorMessage } from "@/lib/ebay/errors";
import { latestSuccessfulRun } from "@/lib/automation/cronRunLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORDER_SYNC_JOBS = ["daily-ebay-sales-sync", "ebay-sales-sync"] as const;

export async function GET() {
  try {
    const prisma = getPrisma();
    const [unmatchedCount, unmatched, cronRuns] = await Promise.all([
      countEbayOrderImports(prisma, "UNMATCHED"),
      readEbayOrderImportQueue(prisma, { status: "UNMATCHED", take: 5 }),
      prisma.cronRun.findMany({
        where: { job: { in: [...ORDER_SYNC_JOBS] }, status: "SUCCESS" },
        orderBy: { startedAt: "desc" },
        take: 10,
      }),
    ]);
    const lastDaily = latestSuccessfulRun(cronRuns, "daily-ebay-sales-sync");
    const lastManual = latestSuccessfulRun(cronRuns, "ebay-sales-sync");
    const last = [lastDaily, lastManual]
      .filter(Boolean)
      .sort((a, b) => (b!.startedAt.getTime() - a!.startedAt.getTime()))[0] ?? null;
    return NextResponse.json({
      unmatched,
      unmatchedCount,
      unmatchedPreviewCount: unmatched.length,
      lastSuccessfulSyncAt: last?.finishedAt?.toISOString() ?? last?.startedAt?.toISOString() ?? null,
      lastSuccessfulSyncJob: last?.job ?? null,
      lastSuccessfulSyncSource: last ? (last.job === "ebay-sales-sync" ? "manual" : "scheduled") : "unknown",
    });
  } catch (err) {
    return NextResponse.json(
      { error: ebayErrorMessage(err, "eBay order import queue lookup failed") },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const prisma = getPrisma();
    const result = await syncOwnEbaySales({ db: prisma as any });
    if (result.ok && !result.skipped) {
      const now = new Date();
      try {
        await prisma.cronRun.create({
          data: {
            job: "ebay-sales-sync",
            runKey: `manual-${now.toISOString()}`,
            status: "SUCCESS",
            startedAt: now,
            finishedAt: now,
            details: {
              matchedCount: result.matchedCount,
              unmatchedCount: result.unmatchedCount,
              fetchedOrders: result.fetchedOrders,
            },
          },
        });
      } catch {
        // Freshness logging must not fail the sync the dealer just ran.
      }
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json(
      ebayApiErrorResponseBody(err, "eBay sales sync failed"),
      { status: 500 },
    );
  }
}
