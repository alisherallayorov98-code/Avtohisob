-- Hujjat raqami faqat tashkilot ichida noyob (avval butun jadval bo'yicha — ikki tashkilotda to'qnashardi)
DROP INDEX IF EXISTS "savdo_sales_documentNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "savdo_sales_orgId_documentNumber_key" ON "savdo_sales"("orgId", "documentNumber");

DROP INDEX IF EXISTS "savdo_specs_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "savdo_specs_orgId_number_key" ON "savdo_specs"("orgId", "number");
