-- Toza-Hudud: Haydovchi statistika jadvali
-- Haftalik va oylik qamrov foizi, streak (ketma-ket yaxshi kun), reyting saqlanadi.
-- updateAllDriverStats() tomonidan 20:00 UZT monitoring tugagach va dushanba 09:00 UZT da yangilanadi.

CREATE TABLE IF NOT EXISTS "th_driver_stats" (
  "id"               TEXT NOT NULL,
  "vehicleId"        TEXT NOT NULL,
  "weekCoveragePct"  INTEGER NOT NULL DEFAULT 0,
  "monthCoveragePct" INTEGER NOT NULL DEFAULT 0,
  "streak"           INTEGER NOT NULL DEFAULT 0,
  "rank"             INTEGER,
  "weekVisited"      INTEGER NOT NULL DEFAULT 0,
  "weekTotal"        INTEGER NOT NULL DEFAULT 0,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "th_driver_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "th_driver_stats_vehicleId_key"
  ON "th_driver_stats"("vehicleId");

CREATE INDEX IF NOT EXISTS "th_driver_stats_weekCoveragePct_idx"
  ON "th_driver_stats"("weekCoveragePct");
