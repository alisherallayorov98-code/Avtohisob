-- FuelReading.lat/lon — anomaliya kelganda xaritada ko'rsatish uchun.
-- Sliv aniqlangan vaqtda mashina aynan qaerda turganini ko'rsatadi.
-- IDEMPOTENT.

ALTER TABLE "fuel_readings" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "fuel_readings" ADD COLUMN IF NOT EXISTS "lon" DOUBLE PRECISION;
