-- OrgSettings'ga bak nazorati threshold'lari qo'shish.
-- Mijoz o'z karyer mashinalariga moslashtirishi uchun.
-- Defaults fuelAnomalyDetector.ts'dagi hardcoded qiymatlar bilan bir xil.
-- IDEMPOTENT.

ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "fuelTheftRateLPerMin" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "fuelTheftMinDropL"    DOUBLE PRECISION NOT NULL DEFAULT 5;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "fuelTheftMaxGapMin"   DOUBLE PRECISION NOT NULL DEFAULT 60;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "fuelRefuelMinRiseL"   DOUBLE PRECISION NOT NULL DEFAULT 5;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "fuelRefuelMaxGapMin"  DOUBLE PRECISION NOT NULL DEFAULT 60;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "fuelRecordWindowMin"  DOUBLE PRECISION NOT NULL DEFAULT 30;
