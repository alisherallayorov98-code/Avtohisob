-- Yashirilgan funksiyalar ro'yxati (sidebar'dan olib tashlanadi)
-- Default: bo'sh array — admin keyinroq Sozlamalardan boshqaradi
ALTER TABLE "org_settings" ADD COLUMN "hiddenFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
