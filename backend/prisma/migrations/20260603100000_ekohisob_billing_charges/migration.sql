-- EkoHisob: to'lov rejimi (billingMode) + oylik hisob (charge) jadvali

-- 1) Tashkilotga yangi maydonlar (mavjud ma'lumotга ta'sir yo'q — default bilan)
ALTER TABLE "ekohisob_legal_entities"
  ADD COLUMN "billingMode" TEXT NOT NULL DEFAULT 'variable',
  ADD COLUMN "contractStartMonth" TEXT,
  ADD COLUMN "contractNumber" TEXT;

CREATE INDEX "ekohisob_legal_entities_billingMode_idx" ON "ekohisob_legal_entities"("billingMode");

-- 2) Oylik hisob (charge) jadvali
CREATE TABLE "ekohisob_charges" (
    "id"             TEXT NOT NULL,
    "entityId"       TEXT NOT NULL,
    "month"          TEXT NOT NULL,
    "expectedAmount" INTEGER NOT NULL,
    "paidAmount"     INTEGER NOT NULL DEFAULT 0,
    "status"         TEXT NOT NULL DEFAULT 'open',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ekohisob_charges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ekohisob_charges_entityId_month_key" ON "ekohisob_charges"("entityId", "month");
CREATE INDEX "ekohisob_charges_entityId_idx" ON "ekohisob_charges"("entityId");
CREATE INDEX "ekohisob_charges_month_idx" ON "ekohisob_charges"("month");
CREATE INDEX "ekohisob_charges_status_idx" ON "ekohisob_charges"("status");

ALTER TABLE "ekohisob_charges"
  ADD CONSTRAINT "ekohisob_charges_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "ekohisob_legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
