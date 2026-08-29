-- AvtoHisob Savdo — 5-bosqich: kassa/POS smena (ochilish/yopilish balansi, kamomad/ortiqcha).
-- Idempotent — qayta ishga tushirish xavfsiz.

CREATE TABLE IF NOT EXISTS "savdo_kassa_smena" (
    "id"              TEXT NOT NULL,
    "orgId"           TEXT NOT NULL,
    "warehouseId"     TEXT NOT NULL,
    "openedById"      TEXT NOT NULL,
    "closedById"      TEXT,
    "openingBalance"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    "closingBalance"  DECIMAL(12,2),
    "expectedBalance" DECIMAL(12,2),
    "discrepancy"     DECIMAL(12,2),
    "status"          TEXT NOT NULL DEFAULT 'open',
    "openedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"        TIMESTAMP(3),

    CONSTRAINT "savdo_kassa_smena_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_kassa_smena_orgId_idx" ON "savdo_kassa_smena"("orgId");
CREATE INDEX IF NOT EXISTS "savdo_kassa_smena_warehouseId_status_idx" ON "savdo_kassa_smena"("warehouseId", "status");

DO $$ BEGIN
  ALTER TABLE "savdo_kassa_smena" ADD CONSTRAINT "savdo_kassa_smena_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "savdo_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- savdo_sales.kassaSmenaId 3-bosqichda opaque ustun sifatida qo'shilgan edi
-- (retrofit qilmaslik uchun oldindan). Endi FK qo'shiladi.
DO $$ BEGIN
  ALTER TABLE "savdo_sales" ADD CONSTRAINT "savdo_sales_kassaSmenaId_fkey"
    FOREIGN KEY ("kassaSmenaId") REFERENCES "savdo_kassa_smena"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
