-- Toza-Hudud AI: Coverage Fingerprint jadvali
-- Har bir vehicle+MFY+oy uchun qoplangan kataklar ro'yxatini saqlaydi.
-- 6 oylik tarix asosida "odatiy" qoplash xaritasini tuzish uchun ishlatiladi.

CREATE TABLE IF NOT EXISTS "th_coverage_fingerprints" (
  "id"         TEXT NOT NULL,
  "vehicleId"  TEXT NOT NULL,
  "mfyId"      TEXT NOT NULL,
  "month"      TEXT NOT NULL,
  "cells"      JSONB NOT NULL DEFAULT '[]',
  "pointCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "th_coverage_fingerprints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "th_coverage_fingerprints_vehicleId_mfyId_month_key"
  ON "th_coverage_fingerprints"("vehicleId", "mfyId", "month");

CREATE INDEX IF NOT EXISTS "th_coverage_fingerprints_vehicleId_idx"
  ON "th_coverage_fingerprints"("vehicleId");

CREATE INDEX IF NOT EXISTS "th_coverage_fingerprints_mfyId_idx"
  ON "th_coverage_fingerprints"("mfyId");
