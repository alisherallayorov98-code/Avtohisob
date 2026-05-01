-- AlterTable: ExpenseCategory ga organizationId qo'shish (nullable, default = null)
-- Mavjud kategoriyalar null = legacy/global (hammaga ko'rinadi)
-- Yangi kategoriyalar yaratuvchining tashkilot id si bilan biriktiriladi
ALTER TABLE "expense_categories" ADD COLUMN "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "expense_categories_organizationId_idx" ON "expense_categories"("organizationId");
