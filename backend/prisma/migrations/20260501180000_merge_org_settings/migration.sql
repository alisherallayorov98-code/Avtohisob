-- OrgSetting va OrgSettings ikki Prisma modeli bir xil "org_settings" jadvaliga
-- map qilingan edi va Prisma validation xato berardi. Endi yagona model
-- (OrgSettings, plural) — barcha sozlamalar shu yerda.
--
-- Bu migratsiya IDEMPOTENT: ustun mavjud bo'lmasa qo'shadi, mavjud bo'lsa o'tkazadi.
-- Eski "20260501140000_add_org_settings" migration buzilgan edi (CREATE TABLE existing).
-- Bu migration shu eski jadvalga (orgId PK bilan) yangi maydonlarni qo'shadi.

-- Soddalashtirilgan ko'rinish (norasmiy yozuvlarni butun saytdan yashirish)
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "simplifiedView" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "simplifiedAt" TIMESTAMP(3);
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "toggledById" TEXT;

-- createdAt — yaratilgan vaqt (yangi yozuvlar uchun)
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- "hiddenFeatures" allaqachon migration "20260501150000_add_hidden_features" da qo'shilgan,
-- agar nostandart holatda bo'lmasa qaytarib qo'shamiz (idempotent):
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "hiddenFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
