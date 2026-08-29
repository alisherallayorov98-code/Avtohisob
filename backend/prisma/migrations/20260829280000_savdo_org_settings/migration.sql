-- AvtoHisob Savdo — chop etiladigan hujjatlar uchun korxona rekvizitlari.
-- Idempotent — qayta ishga tushirish xavfsiz.

CREATE TABLE IF NOT EXISTS "savdo_org_settings" (
    "orgId"       TEXT NOT NULL,
    "companyName" TEXT,
    "stir"        TEXT,
    "address"     TEXT,
    "phone"       TEXT,
    "bankAccount" TEXT,
    "bankName"    TEXT,
    "director"    TEXT,
    "accountant"  TEXT,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savdo_org_settings_pkey" PRIMARY KEY ("orgId")
);
