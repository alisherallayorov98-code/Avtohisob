-- Bakdagi yoqilg'i nazorati — Wialon fuel sensor'idan real-time ma'lumot.
-- IDEMPOTENT: qayta ishga tushirsa ham xavfsiz.
-- Eski Vehicle yozuvlariga ta'sir qilmaydi (yangi maydonlar nullable).

-- 1. Vehicle jadvaliga 4 ta optional maydon
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "tankCapacity" DOUBLE PRECISION;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "fuelSensorName" TEXT;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "lastFuelLevel" DOUBLE PRECISION;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "lastFuelUpdate" TIMESTAMP(3);

-- 2. fuel_readings jadvali — yoqilg'i miqdori snapshot'lari
CREATE TABLE IF NOT EXISTS "fuel_readings" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "level" DOUBLE PRECISION NOT NULL,
  "capacity" DOUBLE PRECISION,
  "percentage" DOUBLE PRECISION,
  "anomaly" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fuel_readings_pkey" PRIMARY KEY ("id")
);

-- 3. Foreign key — vehicle o'chirilsa snapshot'lar ham o'chadi (cascade)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fuel_readings_vehicleId_fkey'
  ) THEN
    ALTER TABLE "fuel_readings"
      ADD CONSTRAINT "fuel_readings_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Indekslar — query performance uchun
CREATE INDEX IF NOT EXISTS "fuel_readings_vehicleId_capturedAt_idx" ON "fuel_readings"("vehicleId", "capturedAt");
CREATE INDEX IF NOT EXISTS "fuel_readings_capturedAt_idx" ON "fuel_readings"("capturedAt");
CREATE INDEX IF NOT EXISTS "fuel_readings_anomaly_idx" ON "fuel_readings"("anomaly");
