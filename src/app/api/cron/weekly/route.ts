import { NextResponse } from "next/server";
import { dispatchCronFailure } from "@/lib/alerts/cronFailure";
import { runRepriceCheck } from "@/lib/alerts/repriceRunner";
import { isAuthorizedCronRequest } from "@/lib/automation/cronAuth";
import { runCronJobOnce, weeklyRunKey } from "@/lib/automation/cronRunLog";
import { getPrisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WEEKLY_LIMIT = 25;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const prisma = getPrisma();
    const now = new Date();
    const runKey = weeklyRunKey(now);
    const weeklyLimit = readWeeklyLimit();
    const reprice = await runCronJobOnce(prisma, {
      job: "weekly-stock-health-reprice",
      runKey,
      now,
      execute: () => runRepriceCheck({ notify: true, limit: weeklyLimit, thresholdPct: 10 }),
      summarize: (result) => ({
        count: result.recommendations.length,
        notified: result.notified,
        notifierConfigured: result.notifierConfigured,
        scannedCount: result.scannedCount,
        skippedCount: result.skippedCount,
        thresholdPct: result.thresholdPct,
      }),
    });

    if (reprice.status === "FAILED") {
      await dispatchCronFailure(prisma, {
        title: "Weekly reprice check failed",
        message: reprice.error.message,
        sourceKey: `cron:${reprice.run.job}:${reprice.run.runKey}`,
        href: "/?view=today",
      });
    }

    return NextResponse.json(
      {
        ok: reprice.status !== "FAILED",
        checkedAt: now.toISOString(),
        runKey,
        limits: { reprice: weeklyLimit },
        reprice: serializeLoggedJob(reprice),
      },
      { status: reprice.status === "FAILED" ? 500 : 200 },
    );
  } catch (err) {
    await dispatchCronFailure(getPrisma(), {
      title: "Weekly automation failed",
      message: err instanceof Error ? err.message : "weekly cron failed",
      sourceKey: `cron:weekly:${new Date().toISOString().slice(0, 10)}:route`,
      href: "/?view=today",
    }).catch(() => undefined);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "weekly cron failed" },
      { status: 500 },
    );
  }
}

function readWeeklyLimit(): number {
  const raw = process.env.WEEKLY_CRON_LIMIT ?? process.env.DAILY_CRON_LIMIT;
  if (!raw) return DEFAULT_WEEKLY_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_WEEKLY_LIMIT;
  return Math.min(parsed, 50);
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
