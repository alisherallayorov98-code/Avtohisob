-- CreateTable
CREATE TABLE IF NOT EXISTS "service_intervals" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "intervalKm" INTEGER NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "warningKm" INTEGER NOT NULL DEFAULT 500,
    "lastServiceKm" INTEGER,
    "lastServiceDate" TIMESTAMP(3),
    "nextDueKm" INTEGER,
    "nextDueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ok',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "service_records" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceIntervalId" TEXT,
    "serviceType" TEXT NOT NULL,
    "servicedAtKm" INTEGER NOT NULL,
    "servicedAt" TIMESTAMP(3) NOT NULL,
    "cost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "technicianName" TEXT,
    "notes" TEXT,
    "nextDueKm" INTEGER,
    "nextDueDate" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_records_pkey" PRIMARY KEY ("id")
);

-- Indexes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'service_intervals_vehicleId_idx') THEN
    CREATE INDEX "service_intervals_vehicleId_idx" ON "service_intervals"("vehicleId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'service_intervals_status_idx') THEN
    CREATE INDEX "service_intervals_status_idx" ON "service_intervals"("status");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'service_intervals_vehicleId_serviceType_key') THEN
    CREATE UNIQUE INDEX "service_intervals_vehicleId_serviceType_key" ON "service_intervals"("vehicleId", "serviceType");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'service_records_vehicleId_idx') THEN
    CREATE INDEX "service_records_vehicleId_idx" ON "service_records"("vehicleId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'service_records_serviceType_idx') THEN
    CREATE INDEX "service_records_serviceType_idx" ON "service_records"("serviceType");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'service_records_servicedAt_idx') THEN
    CREATE INDEX "service_records_servicedAt_idx" ON "service_records"("servicedAt");
  END IF;
END $$;

-- Foreign Keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_intervals_vehicleId_fkey') THEN
    ALTER TABLE "service_intervals" ADD CONSTRAINT "service_intervals_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_records_vehicleId_fkey') THEN
    ALTER TABLE "service_records" ADD CONSTRAINT "service_records_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_records_serviceIntervalId_fkey') THEN
    ALTER TABLE "service_records" ADD CONSTRAINT "service_records_serviceIntervalId_fkey" FOREIGN KEY ("serviceIntervalId") REFERENCES "service_intervals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
