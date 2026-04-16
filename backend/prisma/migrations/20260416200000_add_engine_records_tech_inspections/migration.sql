-- Dvigatel passport jadvali
CREATE TABLE IF NOT EXISTS "engine_records" (
    "id"                 TEXT NOT NULL,
    "vehicleId"          TEXT NOT NULL,
    "recordType"         TEXT NOT NULL,
    "mileage"            DECIMAL(65,30) NOT NULL,
    "date"               TIMESTAMP(3) NOT NULL,
    "description"        TEXT NOT NULL,
    "cost"               DECIMAL(65,30) NOT NULL DEFAULT 0,
    "nextServiceMileage" DECIMAL(65,30),
    "performedBy"        TEXT,
    "notes"              TEXT,
    "createdById"        TEXT NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "engine_records_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "engine_records" ADD CONSTRAINT "engine_records_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engine_records" ADD CONSTRAINT "engine_records_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "engine_records_vehicleId_idx" ON "engine_records"("vehicleId");
CREATE INDEX IF NOT EXISTS "engine_records_date_idx" ON "engine_records"("date");

-- Oylik texnik tekshiruv jadvali
CREATE TABLE IF NOT EXISTS "tech_inspections" (
    "id"             TEXT NOT NULL,
    "vehicleId"      TEXT NOT NULL,
    "branchId"       TEXT,
    "inspectedById"  TEXT NOT NULL,
    "inspectionDate" TIMESTAMP(3) NOT NULL,
    "engineOil"      TEXT NOT NULL DEFAULT 'ok',
    "coolant"        TEXT NOT NULL DEFAULT 'ok',
    "brakes"         TEXT NOT NULL DEFAULT 'ok',
    "transmission"   TEXT NOT NULL DEFAULT 'ok',
    "tires"          TEXT NOT NULL DEFAULT 'ok',
    "lights"         TEXT NOT NULL DEFAULT 'ok',
    "exhaust"        TEXT NOT NULL DEFAULT 'ok',
    "bodyCondition"  TEXT NOT NULL DEFAULT 'ok',
    "overallStatus"  TEXT NOT NULL DEFAULT 'ok',
    "notes"          TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tech_inspections_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "tech_inspections" ADD CONSTRAINT "tech_inspections_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tech_inspections" ADD CONSTRAINT "tech_inspections_inspectedById_fkey"
    FOREIGN KEY ("inspectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "tech_inspections_vehicleId_idx" ON "tech_inspections"("vehicleId");
CREATE INDEX IF NOT EXISTS "tech_inspections_branchId_idx" ON "tech_inspections"("branchId");
CREATE INDEX IF NOT EXISTS "tech_inspections_inspectionDate_idx" ON "tech_inspections"("inspectionDate");
