-- Ustalar hisobi: usta ro'yxati + to'lovlar (qarz balansi uchun)

CREATE TABLE IF NOT EXISTS "masters" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT,
  "name"           TEXT NOT NULL,
  "phone"          TEXT,
  "branchId"       TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "notes"          TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "masters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "masters_organizationId_idx" ON "masters"("organizationId");
CREATE INDEX IF NOT EXISTS "masters_branchId_idx" ON "masters"("branchId");

CREATE TABLE IF NOT EXISTS "master_payments" (
  "id"          TEXT NOT NULL,
  "masterId"    TEXT NOT NULL,
  "amount"      DECIMAL(65,30) NOT NULL DEFAULT 0,
  "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method"      TEXT NOT NULL DEFAULT 'cash',
  "note"        TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "master_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "master_payments_masterId_fkey" FOREIGN KEY ("masterId")
    REFERENCES "masters"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "master_payments_masterId_idx" ON "master_payments"("masterId");
