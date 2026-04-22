-- CreateTable: TireTracking
CREATE TABLE "tire_tracking" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "slotNumber" INTEGER NOT NULL,
    "label" TEXT,
    "serialCode" TEXT,
    "installDate" TIMESTAMP(3) NOT NULL,
    "normKm" INTEGER NOT NULL DEFAULT 50000,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tire_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tire_tracking_vehicleId_slotNumber_key" ON "tire_tracking"("vehicleId", "slotNumber");
CREATE INDEX "tire_tracking_vehicleId_idx" ON "tire_tracking"("vehicleId");

-- AddForeignKey
ALTER TABLE "tire_tracking" ADD CONSTRAINT "tire_tracking_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
