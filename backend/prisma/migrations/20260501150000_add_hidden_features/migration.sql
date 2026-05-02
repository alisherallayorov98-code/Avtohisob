-- Yashirilgan funksiyalar ro'yxati (sidebar'dan olib tashlanadi)
-- Default: bo'sh array — admin keyinroq Sozlamalardan boshqaradi
-- Idempotent (IF NOT EXISTS) — agar avvalroq qisman qo'shilgan bo'lsa xato bermaydi.
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "hiddenFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
