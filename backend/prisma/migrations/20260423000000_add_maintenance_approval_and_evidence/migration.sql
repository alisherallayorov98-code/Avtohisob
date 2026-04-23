-- Approval workflow fields for maintenance_records
ALTER TABLE "maintenance_records"
  ADD COLUMN IF NOT EXISTS "status"         TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS "approvedById"   TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedReason" TEXT;

-- Index on status
CREATE INDEX IF NOT EXISTS "maintenance_records_status_idx" ON "maintenance_records"("status");

-- Foreign key: approvedBy → users
ALTER TABLE "maintenance_records"
  ADD CONSTRAINT "maintenance_records_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Evidence table
CREATE TABLE IF NOT EXISTS "maintenance_evidence" (
  "id"            TEXT NOT NULL,
  "maintenanceId" TEXT NOT NULL,
  "fileUrl"       TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
  "uploadedById"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "maintenance_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "maintenance_evidence_maintenanceId_idx" ON "maintenance_evidence"("maintenanceId");

ALTER TABLE "maintenance_evidence"
  ADD CONSTRAINT "maintenance_evidence_maintenanceId_fkey"
  FOREIGN KEY ("maintenanceId") REFERENCES "maintenance_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
