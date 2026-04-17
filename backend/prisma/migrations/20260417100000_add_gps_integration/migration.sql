-- GPS integratsiya: yangi maydonlar va modellar

-- Vehicle: GPS maydonlari
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "engineHours" DECIMAL;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "lastGpsSignal" TIMESTAMP(3);

-- GpsCredential: GPS ulanish ma'lumotlari (per organization)
CREATE TABLE IF NOT EXISTS "gps_credentials" (
    "id"              TEXT NOT NULL,
    "orgId"           TEXT NOT NULL,
    "provider"        TEXT NOT NULL DEFAULT 'smartgps',
    "host"            TEXT NOT NULL DEFAULT 'https://2.smartgps.uz',
    "username"        TEXT NOT NULL,
    "token"           TEXT NOT NULL,
    "tokenExpiresAt"  TIMESTAMP(3),
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt"      TIMESTAMP(3),
    "lastSyncStatus"  TEXT,
    "lastSyncError"   TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gps_credentials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "gps_credentials_orgId_key" ON "gps_credentials"("orgId");

-- GpsMileageLog: km o'zgarish tarixi
CREATE TABLE IF NOT EXISTS "gps_mileage_logs" (
    "id"              TEXT NOT NULL,
    "vehicleId"       TEXT NOT NULL,
    "syncedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gpsMileageKm"    DECIMAL NOT NULL,
    "prevMileageKm"   DECIMAL NOT NULL,
    "skipped"         BOOLEAN NOT NULL DEFAULT false,
    "skipReason"      TEXT,
    CONSTRAINT "gps_mileage_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "gps_mileage_logs_vehicleId_idx" ON "gps_mileage_logs"("vehicleId");
CREATE INDEX IF NOT EXISTS "gps_mileage_logs_syncedAt_idx" ON "gps_mileage_logs"("syncedAt");
ALTER TABLE "gps_mileage_logs" ADD CONSTRAINT "gps_mileage_logs_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
