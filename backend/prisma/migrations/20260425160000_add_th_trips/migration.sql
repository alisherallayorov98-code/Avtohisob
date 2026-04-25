CREATE TABLE IF NOT EXISTS "th_service_trips" (
  "id"          TEXT NOT NULL,
  "vehicleId"   TEXT NOT NULL,
  "mfyId"       TEXT NOT NULL,
  "date"        DATE NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'not_visited',
  "enteredAt"   TIMESTAMP(3),
  "exitedAt"    TIMESTAMP(3),
  "maxSpeedKmh" DOUBLE PRECISION,
  "suspicious"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "th_service_trips_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "th_service_trips_vehicleId_mfyId_date_key" UNIQUE ("vehicleId", "mfyId", "date"),
  CONSTRAINT "th_service_trips_mfyId_fkey" FOREIGN KEY ("mfyId") REFERENCES "th_mfys"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "th_service_trips_vehicleId_idx" ON "th_service_trips"("vehicleId");
CREATE INDEX IF NOT EXISTS "th_service_trips_mfyId_idx" ON "th_service_trips"("mfyId");
CREATE INDEX IF NOT EXISTS "th_service_trips_date_idx" ON "th_service_trips"("date");

CREATE TABLE IF NOT EXISTS "th_landfill_trips" (
  "id"          TEXT NOT NULL,
  "vehicleId"   TEXT NOT NULL,
  "landfillId"  TEXT NOT NULL,
  "date"        DATE NOT NULL,
  "arrivedAt"   TIMESTAMP(3),
  "leftAt"      TIMESTAMP(3),
  "durationMin" INTEGER,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "th_landfill_trips_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "th_landfill_trips_landfillId_fkey" FOREIGN KEY ("landfillId") REFERENCES "th_landfills"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "th_landfill_trips_vehicleId_idx" ON "th_landfill_trips"("vehicleId");
CREATE INDEX IF NOT EXISTS "th_landfill_trips_landfillId_idx" ON "th_landfill_trips"("landfillId");
CREATE INDEX IF NOT EXISTS "th_landfill_trips_date_idx" ON "th_landfill_trips"("date");
