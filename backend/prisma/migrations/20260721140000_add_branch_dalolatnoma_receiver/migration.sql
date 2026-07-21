-- Dalolatnoma qabul qiluvchi tomoni (filial → boshqarma topshirish uchun).
-- IF NOT EXISTS: mavjud ustunni buzmaydi, siniq migratsiya CI/deploy'ni bloklamasin.
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "receiverOrgName" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "receiverName" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "receiverPosition" TEXT;
