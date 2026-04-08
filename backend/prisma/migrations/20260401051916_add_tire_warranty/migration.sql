-- CreateTable
CREATE TABLE "tires" (
    "id" TEXT NOT NULL,
    "uniqueId" TEXT NOT NULL,
    "serialNumber" TEXT,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dotCode" TEXT,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "purchasePrice" DECIMAL(65,30) NOT NULL,
    "supplierId" TEXT,
    "vehicleId" TEXT,
    "installationDate" TIMESTAMP(3),
    "position" TEXT,
    "initialTreadDepth" DECIMAL(65,30),
    "currentTreadDepth" DECIMAL(65,30),
    "totalMileage" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "warrantyEndDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "condition" TEXT NOT NULL DEFAULT 'good',
    "replacedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "disposalMethod" TEXT,
    "notes" TEXT,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tire_maintenances" (
    "id" TEXT NOT NULL,
    "tireId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "position" TEXT,
    "cost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tire_maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranties" (
    "id" TEXT NOT NULL,
    "partType" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "vehicleId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "mileageLimit" DECIMAL(65,30),
    "coverageType" TEXT NOT NULL DEFAULT 'full',
    "provider" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warranties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tires_uniqueId_key" ON "tires"("uniqueId");

-- CreateIndex
CREATE INDEX "tires_vehicleId_idx" ON "tires"("vehicleId");

-- CreateIndex
CREATE INDEX "tires_status_idx" ON "tires"("status");

-- CreateIndex
CREATE INDEX "tires_branchId_idx" ON "tires"("branchId");

-- CreateIndex
CREATE INDEX "tire_maintenances_tireId_idx" ON "tire_maintenances"("tireId");

-- CreateIndex
CREATE INDEX "warranties_partType_partId_idx" ON "warranties"("partType", "partId");

-- CreateIndex
CREATE INDEX "warranties_endDate_idx" ON "warranties"("endDate");

-- CreateIndex
CREATE INDEX "warranties_vehicleId_idx" ON "warranties"("vehicleId");

-- AddForeignKey
ALTER TABLE "tires" ADD CONSTRAINT "tires_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tires" ADD CONSTRAINT "tires_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tire_maintenances" ADD CONSTRAINT "tire_maintenances_tireId_fkey" FOREIGN KEY ("tireId") REFERENCES "tires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
