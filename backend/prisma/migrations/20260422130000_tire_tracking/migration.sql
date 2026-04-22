-- CreateTable: TireTracking (IF NOT EXISTS — db push bilan avval yaratilgan bo'lishi mumkin)
CREATE TABLE IF NOT EXISTS "tire_tracking" (
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

-- CreateIndex (IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS "tire_tracking_vehicleId_slotNumber_key" ON "tire_tracking"("vehicleId", "slotNumber");
CREATE INDEX IF NOT EXISTS "tire_tracking_vehicleId_idx" ON "tire_tracking"("vehicleId");

-- AddForeignKey (faqat mavjud bo'lmasa)
DO $$ BEGIN
  ALTER TABLE "tire_tracking" ADD CONSTRAINT "tire_tracking_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- serialCode ustuni mavjud bo'lmasa qo'shish
ALTER TABLE "tire_tracking" ADD COLUMN IF NOT EXISTS "serialCode" TEXT;
