import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/automation/cronAuth";
import { dailyRunKey, runCronJobOnce } from "@/lib/automation/cronRunLog";
import { createInboxAlert } from "@/lib/alerts/inbox";
import { runWatchCheck } from "@/lib/alerts/watchRunner";
import { getPrisma } from "@/lib/db/prisma";
import { runPortfolioSnapshot } from "@/lib/snapshots/portfolioRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAILY_LIMIT = 10;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const prisma = getPrisma();
    const now = new Date();
    const runKey = dailyRunKey(now);
    const dailyLimit = readDailyLimit();
    const snapshot = await runCronJobOnce(prisma, {
      job: "daily-portfolio-snapshot",
      runKey,
      now,
      execute: () => runPortfolioSnapshot({ limit: dailyLimit }),
      summarize: (result) => ({
        written: result.written,
        skipped: result.skipped,
        scannedCount: result.scannedCount,
        latestValuePence: result.latest?.marketValuePence ?? null,
      }),
    });
    const watches = await runCronJobOnce(prisma, {
      job: "daily-buy-watch-check",
      runKey,
      now,
      execute: () => runWatchCheck({ notify: true, limit: dailyLimit }),
      summarize: (result) => ({
        count: result.hits.length,
        alertsCreated: result.alertsCreated ?? 0,
        notified: result.notified,
        notifierConfigured: result.notifierConfigured,
        scannedCount: result.scannedCount,
        skippedCount: result.skippedCount,
      }),
    });

    await alertFailedCron(snapshot, "Daily portfolio snapshot");
    await alertFailedCron(watches, "Daily buy-watch check");

    const failed = snapshot.status === "FAILED" || watches.status === "FAILED";

    return NextResponse.json({
      ok: !failed,
      checkedAt: now.toISOString(),
      runKey,
      limits: {
        snapshot: dailyLimit,
        watches: dailyLimit,
      },
      snapshot: serializeLoggedJob(snapshot),
      watches: serializeLoggedJob(watches),
    }, { status: failed ? 500 : 200 });
  } catch (err) {
    await createInboxAlert(getPrisma(), {
      kind: "CRON_FAILURE",
      title: "Daily automation failed",
      message: err instanceof Error ? err.message : "daily cron failed",
      sourceKey: `cron:daily:${new Date().toISOString().slice(0, 10)}:route`,
      href: "/?view=today",
    }).catch(() => undefined);
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

async function alertFailedCron(result: Awaited<ReturnType<typeof runCronJobOnce>>, title: string) {
  if (result.status !== "FAILED") return;
  await createInboxAlert(getPrisma(), {
    kind: "CRON_FAILURE",
    title,
    message: result.error.message,
    sourceKey: `cron:${result.run.job}:${result.run.runKey}`,
    href: "/?view=today",
  });
}

function serializeLoggedJob(result: Awaited<ReturnType<typeof runCronJobOnce>>) {
  if (result.status === "SUCCESS") {
    return { status: result.status, details: result.run.details };
  }
  if (result.status === "SKIPPED") {
    return { status: result.status, details: result.run.details };
  }
  return { status: result.status, error: result.error.message };
}
