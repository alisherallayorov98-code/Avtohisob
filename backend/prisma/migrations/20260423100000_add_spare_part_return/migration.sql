-- SparePartReturn table
CREATE TABLE IF NOT EXISTS "spare_part_returns" (
  "id"             TEXT NOT NULL,
  "maintenanceId"  TEXT,
  "vehicleId"      TEXT,
  "warehouseId"    TEXT NOT NULL,
  "branchId"       TEXT NOT NULL,
  "returnedById"   TEXT NOT NULL,
  "approvedById"   TEXT,
  "approvedAt"     TIMESTAMP(3),
  "rejectedReason" TEXT,
  "status"         TEXT NOT NULL DEFAULT 'pending_approval',
  "returnDate"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason"         TEXT NOT NULL,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "spare_part_returns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "spare_part_returns_status_idx"        ON "spare_part_returns"("status");
CREATE INDEX IF NOT EXISTS "spare_part_returns_branchId_idx"      ON "spare_part_returns"("branchId");
CREATE INDEX IF NOT EXISTS "spare_part_returns_maintenanceId_idx" ON "spare_part_returns"("maintenanceId");

ALTER TABLE "spare_part_returns"
  ADD CONSTRAINT "spare_part_returns_maintenanceId_fkey"
    FOREIGN KEY ("maintenanceId") REFERENCES "maintenance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "spare_part_returns"
  ADD CONSTRAINT "spare_part_returns_returnedById_fkey"
    FOREIGN KEY ("returnedById") REFERENCES "users"("id") ON UPDATE CASCADE;

ALTER TABLE "spare_part_returns"
  ADD CONSTRAINT "spare_part_returns_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SparePartReturnItem table
CREATE TABLE IF NOT EXISTS "spare_part_return_items" (
  "id"          TEXT NOT NULL,
  "returnId"    TEXT NOT NULL,
  "sparePartId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantity"    INTEGER NOT NULL,
  "unitCost"    DECIMAL(65,30) NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "spare_part_return_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "spare_part_return_items_returnId_idx" ON "spare_part_return_items"("returnId");

ALTER TABLE "spare_part_return_items"
  ADD CONSTRAINT "spare_part_return_items_returnId_fkey"
    FOREIGN KEY ("returnId") REFERENCES "spare_part_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "spare_part_return_items"
  ADD CONSTRAINT "spare_part_return_items_sparePartId_fkey"
    FOREIGN KEY ("sparePartId") REFERENCES "spare_parts"("id") ON UPDATE CASCADE;

-- SparePartReturnEvidence table
CREATE TABLE IF NOT EXISTS "spare_part_return_evidence" (
  "id"            TEXT NOT NULL,
  "returnId"      TEXT NOT NULL,
  "fileUrl"       TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
  "uploadedById"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "spare_part_return_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "spare_part_return_evidence_returnId_idx" ON "spare_part_return_evidence"("returnId");

ALTER TABLE "spare_part_return_evidence"
  ADD CONSTRAINT "spare_part_return_evidence_returnId_fkey"
    FOREIGN KEY ("returnId") REFERENCES "spare_part_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
