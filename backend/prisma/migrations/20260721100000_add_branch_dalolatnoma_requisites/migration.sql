-- Dalolatnoma rekvizitlari (Branch) — oylik ehtiyot qism dalolatnomasi hujjatida ishlatiladi.
-- IF NOT EXISTS: mavjud ustunni buzmaydi, siniq migratsiya CI/deploy'ni bloklamasin.
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "officialName" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "stir" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "docAddress" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "directorName" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "engineerName" TEXT;
