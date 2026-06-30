-- GPS bo'yicha yoqilg'i sarfi: kunlik masofa keshi + org rejimi.
-- Hammasi IF NOT EXISTS — qayta ishga tushsa yoki ustun allaqachon bo'lsa no-op.

-- 1) Org sozlamasi: yoqilg'i masofa rejimi ('manual' | 'gps')
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "fuelDistanceMode" TEXT NOT NULL DEFAULT 'manual';

-- 2) Kunlik GPS masofa keshi jadvali
CREATE TABLE IF NOT EXISTS "vehicle_daily_km" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "km" DECIMAL(65,30) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'gps',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vehicle_daily_km_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_daily_km_vehicleId_date_key" ON "vehicle_daily_km"("vehicleId", "date");
CREATE INDEX IF NOT EXISTS "vehicle_daily_km_vehicleId_date_idx" ON "vehicle_daily_km"("vehicleId", "date");

-- FK (mavjud bo'lsa qayta qo'shmaymiz)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'vehicle_daily_km_vehicleId_fkey'
  ) THEN
    ALTER TABLE "vehicle_daily_km"
      ADD CONSTRAINT "vehicle_daily_km_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
