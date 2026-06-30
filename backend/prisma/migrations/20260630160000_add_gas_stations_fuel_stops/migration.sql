-- Event-based aniq sarf hisobi: gaz quyish zonalari + aniqlangan to'xtashlar.
-- Hammasi IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "gas_stations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "radiusM" INTEGER NOT NULL DEFAULT 150,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gas_stations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "gas_stations_orgId_idx" ON "gas_stations"("orgId");

CREATE TABLE IF NOT EXISTS "fuel_stops" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "stationId" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "kmSincePrev" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fuel_stops_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "fuel_stops_vehicleId_enteredAt_key" ON "fuel_stops"("vehicleId", "enteredAt");
CREATE INDEX IF NOT EXISTS "fuel_stops_vehicleId_enteredAt_idx" ON "fuel_stops"("vehicleId", "enteredAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fuel_stops_vehicleId_fkey') THEN
    ALTER TABLE "fuel_stops" ADD CONSTRAINT "fuel_stops_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fuel_stops_stationId_fkey') THEN
    ALTER TABLE "fuel_stops" ADD CONSTRAINT "fuel_stops_stationId_fkey"
      FOREIGN KEY ("stationId") REFERENCES "gas_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
