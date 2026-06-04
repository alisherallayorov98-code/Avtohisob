-- Phase 4: Kvitansiya (ketma-ket raqam), eskalatsiya darajasi, faktura

-- debtLevel: qarz darajasi escalation uchun (monthly_fixed tashkilotlarda)
ALTER TABLE "ekohisob_legal_entities"
  ADD COLUMN "debtLevel" TEXT NOT NULL DEFAULT 'current';
-- current | warning | overdue | critical | blacklisted

-- Kvitansiya jadvali
CREATE TABLE "ekohisob_receipts" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ekohisob_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ekohisob_receipts_paymentId_key" ON "ekohisob_receipts"("paymentId");
CREATE UNIQUE INDEX "ekohisob_receipts_orgId_num_key" ON "ekohisob_receipts"("orgId", "receiptNumber");
CREATE INDEX "ekohisob_receipts_entityId_idx" ON "ekohisob_receipts"("entityId");
CREATE INDEX "ekohisob_receipts_orgId_idx" ON "ekohisob_receipts"("orgId");

ALTER TABLE "ekohisob_receipts"
  ADD CONSTRAINT "ekohisob_receipts_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "ekohisob_legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ekohisob_receipts"
  ADD CONSTRAINT "ekohisob_receipts_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "ekohisob_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ekohisob_receipts"
  ADD CONSTRAINT "ekohisob_receipts_issuedBy_fkey"
  FOREIGN KEY ("issuedBy") REFERENCES "ekohisob_users"("id") ON UPDATE CASCADE;

-- Ketma-ket raqam uchun counter (orgId bo'yicha, har yil sifirlanadi)
CREATE TABLE "ekohisob_receipt_seq" (
    "orgId" TEXT NOT NULL,
    "lastNum" INTEGER NOT NULL DEFAULT 0,
    "year" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ekohisob_receipt_seq_pkey" PRIMARY KEY ("orgId")
);
