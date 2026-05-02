-- "Soddalashtirilgan ko'rinish" + boshqa tashkilot sozlamalari
-- Eslatma: dastlabki versiya CREATE TABLE qilardi, lekin "org_settings" jadvali
-- avvalroq (20260417500000_add_oil_change_settings da) yaratilgan edi va deploy
-- xato bilan tugardi (table already exists).
--
-- Endi idempotent: faqat etishmayotgan ustunlarni qo'shadi. Mavjud
-- "org_settings" (orgId @id) jadvaliga simplifiedView/simplifiedAt/toggledById/
-- createdAt ustunlari xavfsiz qo'shiladi. Schema endi yagona OrgSettings
-- modeli (orgId PK) bilan moslashtirilgan.

ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "simplifiedView" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "simplifiedAt" TIMESTAMP(3);
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "toggledById" TEXT;
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
