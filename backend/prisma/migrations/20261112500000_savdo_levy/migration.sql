-- Yig'imlar (utilizatsiya): eng kam oylik, yig'im turlari, mahsulot og'irligi, kirim qatori snapshot'i
CREATE TABLE IF NOT EXISTS "savdo_levy_rates" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "basis" TEXT NOT NULL,
  "percent" DECIMAL(8,4) NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "savdo_levy_rates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_levy_rates_orgId_idx" ON "savdo_levy_rates"("orgId");

ALTER TABLE "savdo_org_settings" ADD COLUMN IF NOT EXISTS "minimumWage" DECIMAL(14,2);

ALTER TABLE "savdo_products" ADD COLUMN IF NOT EXISTS "weightKg" DECIMAL(12,3);
ALTER TABLE "savdo_products" ADD COLUMN IF NOT EXISTS "levyRateId" TEXT;

ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "unitWeightKg" DECIMAL(12,3);
ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "levyRateId" TEXT;
ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "levyName" TEXT;
ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "levyBasis" TEXT;
ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "levyPercent" DECIMAL(8,4);
ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "levyAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "savdo_purchase_docs" ADD COLUMN IF NOT EXISTS "minWage" DECIMAL(14,2);
