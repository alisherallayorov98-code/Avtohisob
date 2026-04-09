-- AlterTable
ALTER TABLE "spare_parts" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "tires" DROP COLUMN IF EXISTS "replacedAt",
ADD COLUMN IF NOT EXISTS "actualMileageUsed" INTEGER,
ADD COLUMN IF NOT EXISTS "driverId" TEXT,
ADD COLUMN IF NOT EXISTS "installedMileageKm" INTEGER,
ADD COLUMN IF NOT EXISTS "removedDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "removedMileageKm" INTEGER,
ADD COLUMN IF NOT EXISTS "standardMileageKm" INTEGER NOT NULL DEFAULT 40000;

-- Add serialCode with default for existing rows, then add unique constraint
ALTER TABLE "tires" ADD COLUMN IF NOT EXISTS "serialCode" TEXT;
UPDATE "tires" SET "serialCode" = id WHERE "serialCode" IS NULL;
ALTER TABLE "tires" ALTER COLUMN "serialCode" SET NOT NULL;

ALTER TABLE "tires" ALTER COLUMN "status" SET DEFAULT 'in_stock';

-- CreateTable
CREATE TABLE IF NOT EXISTS "tire_events" (
    "id" TEXT NOT NULL,
    "tireId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "mileageAtEvent" INTEGER,
    "position" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tire_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tire_deductions" (
    "id" TEXT NOT NULL,
    "tireId" TEXT NOT NULL,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "standardMileageKm" INTEGER NOT NULL,
    "actualMileageKm" INTEGER NOT NULL,
    "remainingMileageKm" INTEGER NOT NULL,
    "purchasePrice" DECIMAL(65,30) NOT NULL,
    "deductionPerKm" DECIMAL(65,30) NOT NULL,
    "deductionAmount" DECIMAL(65,30) NOT NULL,
    "reason" TEXT,
    "isSettled" BOOLEAN NOT NULL DEFAULT false,
    "settledAt" TIMESTAMP(3),
    "settledNotes" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tire_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fuel_imports" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "fileType" TEXT,
    "sourceFile" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fuel_import_rows" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "refuelDate" TIMESTAMP(3),
    "licensePlate" TEXT,
    "vehicleId" TEXT,
    "waybillNo" TEXT,
    "quantityM3" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "pricePerUnit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "driverName" TEXT,
    "driverId" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "odometerReading" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "fuelRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (IF NOT EXISTS not supported in older PG, use DO block)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tire_events_tireId_idx') THEN
    CREATE INDEX "tire_events_tireId_idx" ON "tire_events"("tireId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tire_events_eventType_idx') THEN
    CREATE INDEX "tire_events_eventType_idx" ON "tire_events"("eventType");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tire_deductions_tireId_idx') THEN
    CREATE INDEX "tire_deductions_tireId_idx" ON "tire_deductions"("tireId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tire_deductions_driverId_idx') THEN
    CREATE INDEX "tire_deductions_driverId_idx" ON "tire_deductions"("driverId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tire_deductions_isSettled_idx') THEN
    CREATE INDEX "tire_deductions_isSettled_idx" ON "tire_deductions"("isSettled");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'fuel_imports_status_idx') THEN
    CREATE INDEX "fuel_imports_status_idx" ON "fuel_imports"("status");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'fuel_imports_year_month_idx') THEN
    CREATE INDEX "fuel_imports_year_month_idx" ON "fuel_imports"("year", "month");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'fuel_import_rows_importId_idx') THEN
    CREATE INDEX "fuel_import_rows_importId_idx" ON "fuel_import_rows"("importId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tires_serialCode_key') THEN
    CREATE UNIQUE INDEX "tires_serialCode_key" ON "tires"("serialCode");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'tires_serialCode_idx') THEN
    CREATE INDEX "tires_serialCode_idx" ON "tires"("serialCode");
  END IF;
END $$;

-- AddForeignKey (IF NOT EXISTS)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tires_driverId_fkey') THEN
    ALTER TABLE "tires" ADD CONSTRAINT "tires_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tire_events_tireId_fkey') THEN
    ALTER TABLE "tire_events" ADD CONSTRAINT "tire_events_tireId_fkey" FOREIGN KEY ("tireId") REFERENCES "tires"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tire_deductions_tireId_fkey') THEN
    ALTER TABLE "tire_deductions" ADD CONSTRAINT "tire_deductions_tireId_fkey" FOREIGN KEY ("tireId") REFERENCES "tires"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuel_import_rows_importId_fkey') THEN
    ALTER TABLE "fuel_import_rows" ADD CONSTRAINT "fuel_import_rows_importId_fkey" FOREIGN KEY ("importId") REFERENCES "fuel_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
