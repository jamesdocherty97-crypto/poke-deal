-- Automation hygiene: scheduled run logs and an app-visible alert inbox.

CREATE TYPE "CronRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');
CREATE TYPE "AppAlertKind" AS ENUM ('PRICE_DROP', 'REPRICE', 'CRON_FAILURE');

CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "status" "CronRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "details" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppAlert" (
    "id" TEXT NOT NULL,
    "kind" "AppAlertKind" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "pence" INTEGER,
    "href" TEXT,
    "sourceKey" TEXT,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CronRun_job_runKey_key" ON "CronRun"("job", "runKey");
CREATE INDEX "CronRun_job_startedAt_idx" ON "CronRun"("job", "startedAt");
CREATE INDEX "CronRun_status_idx" ON "CronRun"("status");

CREATE UNIQUE INDEX "AppAlert_sourceKey_key" ON "AppAlert"("sourceKey");
CREATE INDEX "AppAlert_kind_idx" ON "AppAlert"("kind");
CREATE INDEX "AppAlert_readAt_createdAt_idx" ON "AppAlert"("readAt", "createdAt");
CREATE INDEX "AppAlert_createdAt_idx" ON "AppAlert"("createdAt");
