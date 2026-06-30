-- Yoqilg'i masofa rejimi standart: GPS (gibrid — GPS yo'q bo'lsa odometrga tushadi).
-- Funksiya hozirgina chiqdi; mavjud 'manual' qiymatlar foydalanuvchi tanlovi emas,
-- balki avvalgi default edi — shuning uchun ularni GPS ga o'tkazamiz.
ALTER TABLE "org_settings" ALTER COLUMN "fuelDistanceMode" SET DEFAULT 'gps';
UPDATE "org_settings" SET "fuelDistanceMode" = 'gps' WHERE "fuelDistanceMode" = 'manual';
