-- CreateTable: eski qism qarzi tizimi
CREATE TABLE "old_part_debts" (
    "id"              TEXT NOT NULL,
    "maintenanceId"   TEXT NOT NULL,
    "vehicleId"       TEXT NOT NULL,
    "vehicleLabel"    TEXT NOT NULL,
    "workerId"        TEXT NOT NULL,
    "workerName"      TEXT NOT NULL,
    "branchId"        TEXT NOT NULL,
    "sparePartId"     TEXT NOT NULL,
    "sparePartName"   TEXT NOT NULL,
    "quantity"        INTEGER NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'open',
    "submittedAt"     TIMESTAMP(3),
    "submissionNote"  TEXT,
    "deliveryMethod"  TEXT,
    "approvedAt"      TIMESTAMP(3),
    "approvedById"    TEXT,
    "rejectedReason"  TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "old_part_debts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "old_part_debt_evidence" (
    "id"            TEXT NOT NULL,
    "debtId"        TEXT NOT NULL,
    "fileUrl"       TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "uploadedById"  TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "old_part_debt_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "old_part_debts_status_idx"        ON "old_part_debts"("status");
CREATE INDEX "old_part_debts_workerId_idx"       ON "old_part_debts"("workerId");
CREATE INDEX "old_part_debts_branchId_idx"       ON "old_part_debts"("branchId");
CREATE INDEX "old_part_debts_maintenanceId_idx"  ON "old_part_debts"("maintenanceId");
CREATE INDEX "old_part_debt_evidence_debtId_idx" ON "old_part_debt_evidence"("debtId");

-- AddForeignKey
ALTER TABLE "old_part_debts" ADD CONSTRAINT "old_part_debts_maintenanceId_fkey"
    FOREIGN KEY ("maintenanceId") REFERENCES "maintenance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "old_part_debts" ADD CONSTRAINT "old_part_debts_workerId_fkey"
    FOREIGN KEY ("workerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "old_part_debts" ADD CONSTRAINT "old_part_debts_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "old_part_debt_evidence" ADD CONSTRAINT "old_part_debt_evidence_debtId_fkey"
    FOREIGN KEY ("debtId") REFERENCES "old_part_debts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
