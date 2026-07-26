-- EkoHisob: audit jurnali, korxona sozlamalari, talon↔to'lov bog'i, soya foydalanuvchi.
-- Barcha amallar idempotent (IF NOT EXISTS) — qayta ishga tushirish xavfsiz.

-- 1. Audit jurnali — pulga ta'sir qiluvchi amallar tarixi
CREATE TABLE IF NOT EXISTS "ekohisob_audit_logs" (
    "id"         TEXT NOT NULL,
    "orgId"      TEXT NOT NULL,
    "userId"     TEXT,
    "userName"   TEXT NOT NULL DEFAULT '—',
    "action"     TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId"   TEXT,
    "targetName" TEXT,
    "amount"     INTEGER,
    "details"    JSONB,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ekohisob_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ekohisob_audit_logs_orgId_createdAt_idx"
    ON "ekohisob_audit_logs"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "ekohisob_audit_logs_targetId_idx"
    ON "ekohisob_audit_logs"("targetId");
CREATE INDEX IF NOT EXISTS "ekohisob_audit_logs_action_idx"
    ON "ekohisob_audit_logs"("action");

-- 2. Korxona sozlamalari — SMS oylik limiti (ilgari ENV, barchaga bir xil edi)
CREATE TABLE IF NOT EXISTS "ekohisob_org_settings" (
    "orgId"           TEXT NOT NULL,
    "smsMonthlyLimit" INTEGER,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ekohisob_org_settings_pkey" PRIMARY KEY ("orgId")
);

-- 3. Talon ↔ to'lov bog'i: talon "to'landi" bo'lganda rasmiy to'lov yaratiladi
ALTER TABLE "ekohisob_talons" ADD COLUMN IF NOT EXISTS "paymentId" TEXT;
CREATE INDEX IF NOT EXISTS "ekohisob_talons_paymentId_idx"
    ON "ekohisob_talons"("paymentId");

-- 4. Soya foydalanuvchi: asosiy AutoHisob admin EkoHisob'da to'lov qilganda
--    receivedBy/issuedBy FK'lari uchun real qator kerak. Ro'yxatlarda ko'rinmaydi.
ALTER TABLE "ekohisob_users" ADD COLUMN IF NOT EXISTS "isMirror" BOOLEAN NOT NULL DEFAULT false;
