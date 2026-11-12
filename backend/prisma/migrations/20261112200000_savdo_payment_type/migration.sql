-- Sotuv to'lov turi: cash (naqd) | transfer (perechisleniya) | credit (qarz) + muddat
ALTER TABLE "savdo_sales" ADD COLUMN IF NOT EXISTS "paymentType" TEXT NOT NULL DEFAULT 'credit';
ALTER TABLE "savdo_sales" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "savdo_sales_orgId_paymentType_idx" ON "savdo_sales"("orgId", "paymentType");
-- Kassa (POS) sotuvlari doim naqd
UPDATE "savdo_sales" SET "paymentType" = 'cash' WHERE "saleType" = 'pos' AND "paymentType" = 'credit';

ALTER TABLE "savdo_specs" ADD COLUMN IF NOT EXISTS "paymentType" TEXT NOT NULL DEFAULT 'transfer';
ALTER TABLE "savdo_specs" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
