-- Import kirim: xarajat guruhlari (bojxona / qo'shimcha), qoralama, hujjat raqami
ALTER TABLE "savdo_purchase_costs" ADD COLUMN IF NOT EXISTS "group" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "extraCustoms" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "extraOther" DECIMAL(14,2) NOT NULL DEFAULT 0;
-- Eski hujjatlarda bo'linish bo'lmagan: butun xarajat (yig'imdan tashqari) "qo'shimcha" hisoblanadi
UPDATE "savdo_purchases" SET "extraOther" = GREATEST("extraCost" - "levyAmount", 0)
  WHERE "docId" IS NOT NULL AND "extraCustoms" = 0 AND "extraOther" = 0 AND "extraCost" > 0;
ALTER TABLE "savdo_purchase_docs" ADD COLUMN IF NOT EXISTS "number" TEXT;
ALTER TABLE "savdo_purchase_docs" ADD COLUMN IF NOT EXISTS "draftPayload" JSONB;
ALTER TABLE "savdo_purchase_docs" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
