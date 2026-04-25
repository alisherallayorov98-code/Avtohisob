CREATE TABLE IF NOT EXISTS "th_schedules" (
  "id"        TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "mfyId"     TEXT NOT NULL,
  "dayOfWeek" INTEGER[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "th_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "th_schedules_vehicleId_mfyId_key" UNIQUE ("vehicleId", "mfyId"),
  CONSTRAINT "th_schedules_mfyId_fkey" FOREIGN KEY ("mfyId") REFERENCES "th_mfys"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "th_schedules_vehicleId_idx" ON "th_schedules"("vehicleId");
CREATE INDEX IF NOT EXISTS "th_schedules_mfyId_idx" ON "th_schedules"("mfyId");
