-- AvtoHisob Savdo — omborlararo ko'chirish, xarajat (sof foyda) va qarzdorlarga
-- SMS eslatma jurnali. Idempotent: qayta ishga tushirish xavfsiz.

-- ── Omborlararo ko'chirish ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "savdo_transfers" (
  "id"              TEXT NOT NULL,
  "orgId"           TEXT NOT NULL,
  "fromWarehouseId" TEXT NOT NULL,
  "toWarehouseId"   TEXT NOT NULL,
  "productId"       TEXT NOT NULL,
  "quantity"        INTEGER NOT NULL,
  "totalCost"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "status"          TEXT NOT NULL DEFAULT 'completed',
  "transferredById" TEXT,
  "notes"           TEXT,
  "cancelledById"   TEXT,
  "cancelledAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "savdo_transfers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_transfers_orgId_idx"     ON "savdo_transfers"("orgId");
CREATE INDEX IF NOT EXISTS "savdo_transfers_productId_idx" ON "savdo_transfers"("productId");
CREATE INDEX IF NOT EXISTS "savdo_transfers_createdAt_idx" ON "savdo_transfers"("createdAt");

DO $$ BEGIN
  ALTER TABLE "savdo_transfers" ADD CONSTRAINT "savdo_transfers_fromWarehouseId_fkey"
    FOREIGN KEY ("fromWarehouseId") REFERENCES "savdo_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_transfers" ADD CONSTRAINT "savdo_transfers_toWarehouseId_fkey"
    FOREIGN KEY ("toWarehouseId") REFERENCES "savdo_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_transfers" ADD CONSTRAINT "savdo_transfers_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "savdo_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Xarajat (sof foyda) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "savdo_expenses" (
  "id"            TEXT NOT NULL,
  "orgId"         TEXT NOT NULL,
  "category"      TEXT NOT NULL,
  "amount"        DECIMAL(14,2) NOT NULL,
  "spentAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note"          TEXT,
  "warehouseId"   TEXT,
  "createdById"   TEXT,
  "cancelled"     BOOLEAN NOT NULL DEFAULT false,
  "cancelledById" TEXT,
  "cancelledAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "savdo_expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_expenses_orgId_idx"     ON "savdo_expenses"("orgId");
CREATE INDEX IF NOT EXISTS "savdo_expenses_spentAt_idx"   ON "savdo_expenses"("spentAt");
CREATE INDEX IF NOT EXISTS "savdo_expenses_cancelled_idx" ON "savdo_expenses"("cancelled");

DO $$ BEGIN
  ALTER TABLE "savdo_expenses" ADD CONSTRAINT "savdo_expenses_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "savdo_warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── SMS jurnali + sozlamalar ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "savdo_sms_logs" (
  "id"            TEXT NOT NULL,
  "orgId"         TEXT NOT NULL,
  "customerId"    TEXT,
  "phone"         TEXT NOT NULL,
  "message"       TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'sent',
  "providerMsgId" TEXT,
  "error"         TEXT,
  "sentBy"        TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "savdo_sms_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_sms_logs_orgId_idx"      ON "savdo_sms_logs"("orgId");
CREATE INDEX IF NOT EXISTS "savdo_sms_logs_customerId_idx" ON "savdo_sms_logs"("customerId");
CREATE INDEX IF NOT EXISTS "savdo_sms_logs_createdAt_idx"  ON "savdo_sms_logs"("createdAt");

DO $$ BEGIN
  ALTER TABLE "savdo_sms_logs" ADD CONSTRAINT "savdo_sms_logs_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "savdo_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "savdo_org_settings" ADD COLUMN IF NOT EXISTS "smsEnabled"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "savdo_org_settings" ADD COLUMN IF NOT EXISTS "smsTemplate" TEXT;
