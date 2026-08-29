-- AvtoHisob Savdo — 4-bosqich: mijoz to'lovlari (qarz hisoblanadi, saqlanmaydi).
-- Idempotent — qayta ishga tushirish xavfsiz.

CREATE TABLE IF NOT EXISTS "savdo_payments" (
    "id"           TEXT NOT NULL,
    "orgId"        TEXT NOT NULL,
    "customerId"   TEXT NOT NULL,
    "saleId"       TEXT,
    "amount"       DECIMAL(12,2) NOT NULL,
    "method"       TEXT NOT NULL DEFAULT 'cash',
    "paidAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT NOT NULL,
    "note"         TEXT,
    "groupId"      TEXT,

    CONSTRAINT "savdo_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_payments_orgId_idx" ON "savdo_payments"("orgId");
CREATE INDEX IF NOT EXISTS "savdo_payments_customerId_idx" ON "savdo_payments"("customerId");
CREATE INDEX IF NOT EXISTS "savdo_payments_saleId_idx" ON "savdo_payments"("saleId");

DO $$ BEGIN
  ALTER TABLE "savdo_payments" ADD CONSTRAINT "savdo_payments_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "savdo_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_payments" ADD CONSTRAINT "savdo_payments_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "savdo_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
