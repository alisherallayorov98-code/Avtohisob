-- 6 oylik GPS backfill: progress (job) + qayta tortmaslik (coverage).
-- Hammasi IF NOT EXISTS — xavfsiz qayta ishga tushish.

-- 1) Backfill job holati (0→100% progress)
CREATE TABLE IF NOT EXISTS "gps_backfill_jobs" (
    "orgId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gps_backfill_jobs_pkey" PRIMARY KEY ("orgId")
);

-- 2) Hafta coverage markeri (qayta tortmaslik)
CREATE TABLE IF NOT EXISTS "vehicle_daily_km_coverage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vehicle_daily_km_coverage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_daily_km_coverage_orgId_weekStart_key" ON "vehicle_daily_km_coverage"("orgId", "weekStart");
CREATE INDEX IF NOT EXISTS "vehicle_daily_km_coverage_orgId_idx" ON "vehicle_daily_km_coverage"("orgId");
