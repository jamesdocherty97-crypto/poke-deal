export type CronRunStatus = "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";

export type CronRunRow = {
  id: string;
  job: string;
  runKey: string;
  status: CronRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  details: unknown;
  error: string | null;
};

type CronRunDelegate = {
  findUnique(args: any): Promise<CronRunRow | null>;
  findMany(args?: any): Promise<CronRunRow[]>;
  create(args: any): Promise<CronRunRow>;
  update(args: any): Promise<CronRunRow>;
  updateMany(args: any): Promise<{ count: number }>;
};

type CronRunDb = {
  cronRun: CronRunDelegate;
};

export type LoggedCronJobResult<T> =
  | { status: "SUCCESS"; run: CronRunRow; result: T }
  | { status: "SKIPPED"; run: CronRunRow; result: null }
  | { status: "FAILED"; run: CronRunRow; error: Error };

const DEFAULT_CRON_LEASE_MS = 15 * 60 * 1000;

export async function runCronJobOnce<T>(
  db: CronRunDb,
  input: {
    job: string;
    runKey: string;
    now?: Date;
    execute: () => Promise<T>;
    summarize?: (result: T) => unknown;
    leaseMs?: number;
  },
): Promise<LoggedCronJobResult<T>> {
  const startedAt = input.now ?? new Date();
  const leaseMs = normalizeLeaseMs(input.leaseMs);
  const existing = await db.cronRun.findUnique({
    where: { job_runKey: { job: input.job, runKey: input.runKey } },
  });

  if (existing?.status === "SUCCESS") {
    return { status: "SKIPPED", run: existing, result: null };
  }

  if (existing?.status === "RUNNING" && !isStaleCronRun(existing, startedAt, leaseMs)) {
    return { status: "SKIPPED", run: existing, result: null };
  }

  let run: CronRunRow;
  if (existing?.status === "RUNNING") {
    const claimed = await db.cronRun.updateMany({
      where: { id: existing.id, status: "RUNNING", startedAt: existing.startedAt },
      data: { status: "RUNNING", startedAt, finishedAt: null, error: null, details: null },
    });
    if (claimed.count === 0) {
      const current = await db.cronRun.findUnique({
        where: { job_runKey: { job: input.job, runKey: input.runKey } },
      });
      return { status: "SKIPPED", run: current ?? existing, result: null };
    }
    run =
      (await db.cronRun.findUnique({
        where: { job_runKey: { job: input.job, runKey: input.runKey } },
      })) ?? { ...existing, startedAt, finishedAt: null, error: null, details: null };
  } else if (existing) {
    run = await db.cronRun.update({
      where: { id: existing.id },
      data: { status: "RUNNING", startedAt, finishedAt: null, error: null, details: null },
    });
  } else {
    run = await db.cronRun.create({
      data: { job: input.job, runKey: input.runKey, status: "RUNNING", startedAt },
    });
  }

  try {
    const result = await input.execute();
    const saved = await db.cronRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        details: input.summarize ? input.summarize(result) : result,
        error: null,
      },
    });
    return { status: "SUCCESS", run: saved, result };
  } catch (err) {
    const error = err instanceof Error ? err : new Error("cron job failed");
    const saved = await db.cronRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: error.message,
      },
    });
    return { status: "FAILED", run: saved, error };
  }
}

export function isStaleCronRun(
  run: Pick<CronRunRow, "status" | "startedAt">,
  now = new Date(),
  leaseMs = DEFAULT_CRON_LEASE_MS,
): boolean {
  return run.status === "RUNNING" && now.getTime() - run.startedAt.getTime() >= normalizeLeaseMs(leaseMs);
}

function normalizeLeaseMs(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(1_000, Math.min(60 * 60 * 1000, Math.round(value!))) : DEFAULT_CRON_LEASE_MS;
}

export function dailyRunKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function weeklyRunKey(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function latestSuccessfulRun(rows: CronRunRow[], job: string): CronRunRow | null {
  return rows
    .filter((row) => row.job === job && row.status === "SUCCESS")
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null;
}
