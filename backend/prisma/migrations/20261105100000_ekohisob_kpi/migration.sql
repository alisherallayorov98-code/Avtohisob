-- EkoHisob KPI: inspektor ko'rsatkichlari, qo'lda qiymatlar, admin tuzatishlari, oy davrlari.
-- Barcha amallar idempotent — qayta ishga tushirish xavfsiz.

CREATE TABLE IF NOT EXISTS "ekohisob_kpi_schemes" (
    "id"         TEXT NOT NULL,
    "orgId"      TEXT NOT NULL,
    "bonusMax"   INTEGER NOT NULL DEFAULT 0,
    "minScore"   INTEGER NOT NULL DEFAULT 50,
    "capPercent" INTEGER NOT NULL DEFAULT 120,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ekohisob_kpi_schemes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ekohisob_kpi_schemes_orgId_key" ON "ekohisob_kpi_schemes"("orgId");

CREATE TABLE IF NOT EXISTS "ekohisob_kpi_indicators" (
    "id"        TEXT NOT NULL,
    "orgId"     TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "metric"    TEXT,
    "unit"      TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL DEFAULT 'higher',
    "target"    DOUBLE PRECISION NOT NULL,
    "weight"    INTEGER NOT NULL DEFAULT 0,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ekohisob_kpi_indicators_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ekohisob_kpi_indicators_orgId_idx" ON "ekohisob_kpi_indicators"("orgId");

CREATE TABLE IF NOT EXISTS "ekohisob_kpi_entries" (
    "id"          TEXT NOT NULL,
    "orgId"       TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "month"       TEXT NOT NULL,
    "value"       DOUBLE PRECISION NOT NULL,
    "note"        TEXT,
    "updatedBy"   TEXT,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ekohisob_kpi_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ekohisob_kpi_entries_indicatorId_userId_month_key"
    ON "ekohisob_kpi_entries"("indicatorId", "userId", "month");
CREATE INDEX IF NOT EXISTS "ekohisob_kpi_entries_orgId_month_idx" ON "ekohisob_kpi_entries"("orgId", "month");

CREATE TABLE IF NOT EXISTS "ekohisob_kpi_adjustments" (
    "id"         TEXT NOT NULL,
    "orgId"      TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "month"      TEXT NOT NULL,
    "points"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonusDelta" INTEGER NOT NULL DEFAULT 0,
    "reason"     TEXT NOT NULL,
    "createdBy"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ekohisob_kpi_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ekohisob_kpi_adjustments_orgId_month_idx" ON "ekohisob_kpi_adjustments"("orgId", "month");
CREATE INDEX IF NOT EXISTS "ekohisob_kpi_adjustments_userId_month_idx" ON "ekohisob_kpi_adjustments"("userId", "month");

CREATE TABLE IF NOT EXISTS "ekohisob_kpi_periods" (
    "id"            TEXT NOT NULL,
    "orgId"         TEXT NOT NULL,
    "month"         TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'open',
    "snapshot"      JSONB,
    "closedAt"      TIMESTAMP(3),
    "closedBy"      TEXT,
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ekohisob_kpi_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ekohisob_kpi_periods_orgId_month_key" ON "ekohisob_kpi_periods"("orgId", "month");
