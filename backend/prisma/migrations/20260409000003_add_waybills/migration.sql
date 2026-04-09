-- CreateTable
CREATE TABLE IF NOT EXISTS "waybills" (
    "id"                   TEXT NOT NULL,
    "number"               TEXT NOT NULL,
    "branchId"             TEXT NOT NULL,
    "vehicleId"            TEXT NOT NULL,
    "driverId"             TEXT NOT NULL,
    "status"               TEXT NOT NULL DEFAULT 'draft',
    "purpose"              TEXT NOT NULL,
    "destination"          TEXT NOT NULL,
    "routeDescription"     TEXT,
    "plannedDeparture"     TIMESTAMP(3) NOT NULL,
    "plannedReturn"        TIMESTAMP(3),
    "actualDeparture"      TIMESTAMP(3),
    "actualReturn"         TIMESTAMP(3),
    "departureOdometer"    INTEGER,
    "returnOdometer"       INTEGER,
    "distanceTraveled"     INTEGER,
    "fuelAtDeparture"      DECIMAL(65,30) NOT NULL DEFAULT 0,
    "fuelIssued"           DECIMAL(65,30) NOT NULL DEFAULT 0,
    "fuelAtReturn"         DECIMAL(65,30) NOT NULL DEFAULT 0,
    "fuelConsumed"         DECIMAL(65,30),
    "mechanicName"         TEXT,
    "mechanicCheckedAt"    TIMESTAMP(3),
    "mechanicApproved"     BOOLEAN NOT NULL DEFAULT false,
    "dispatcherName"       TEXT,
    "notes"                TEXT,
    "createdById"          TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waybills_pkey" PRIMARY KEY ("id")
);

-- Unique & Indexes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'waybills_number_key') THEN
    CREATE UNIQUE INDEX "waybills_number_key" ON "waybills"("number");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'waybills_branchId_idx') THEN
    CREATE INDEX "waybills_branchId_idx" ON "waybills"("branchId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'waybills_vehicleId_idx') THEN
    CREATE INDEX "waybills_vehicleId_idx" ON "waybills"("vehicleId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'waybills_driverId_idx') THEN
    CREATE INDEX "waybills_driverId_idx" ON "waybills"("driverId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'waybills_status_idx') THEN
    CREATE INDEX "waybills_status_idx" ON "waybills"("status");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'waybills_plannedDeparture_idx') THEN
    CREATE INDEX "waybills_plannedDeparture_idx" ON "waybills"("plannedDeparture");
  END IF;
END $$;

-- ForeignKeys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waybills_branchId_fkey') THEN
    ALTER TABLE "waybills" ADD CONSTRAINT "waybills_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waybills_vehicleId_fkey') THEN
    ALTER TABLE "waybills" ADD CONSTRAINT "waybills_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waybills_driverId_fkey') THEN
    ALTER TABLE "waybills" ADD CONSTRAINT "waybills_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waybills_createdById_fkey') THEN
    ALTER TABLE "waybills" ADD CONSTRAINT "waybills_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
