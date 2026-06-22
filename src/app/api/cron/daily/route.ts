import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/automation/cronAuth";
import { runRepriceCheck } from "@/lib/alerts/repriceRunner";
import { runWatchCheck } from "@/lib/alerts/watchRunner";
import { runPortfolioSnapshot } from "@/lib/snapshots/portfolioRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAILY_LIMIT = 10;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const dailyLimit = readDailyLimit();
    const snapshot = await runPortfolioSnapshot({ limit: dailyLimit });
    const reprice = await runRepriceCheck({ notify: true, limit: dailyLimit, thresholdPct: 10 });
    const watches = await runWatchCheck({ notify: true, limit: dailyLimit });

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      limits: {
        snapshot: dailyLimit,
        reprice: dailyLimit,
        watches: dailyLimit,
      },
      snapshot: {
        written: snapshot.written,
        skipped: snapshot.skipped,
        scannedCount: snapshot.scannedCount,
        latestValuePence: snapshot.latest?.marketValuePence ?? null,
      },
      reprice: {
        count: reprice.recommendations.length,
        notified: reprice.notified,
        notifierConfigured: reprice.notifierConfigured,
        scannedCount: reprice.scannedCount,
      },
      watches: {
        count: watches.hits.length,
        notified: watches.notified,
        notifierConfigured: watches.notifierConfigured,
        scannedCount: watches.scannedCount,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "daily cron failed" },
      { status: 500 },
    );
  }
}

function readDailyLimit(): number {
  const raw = process.env.DAILY_CRON_LIMIT;
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_DAILY_LIMIT;
  return Math.min(parsed, 25);
}
