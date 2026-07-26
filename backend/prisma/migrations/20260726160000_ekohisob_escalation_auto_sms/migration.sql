-- EkoHisob: qarz eskalatsiyasi va avtomatik SMS eslatma sozlamalari.
-- Barcha amallar idempotent — qayta ishga tushirish xavfsiz.

-- 1. Korxona sozlamalari: avto-SMS va eskalatsiya kalitlari
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "smsAutoEnabled"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "smsAutoDay"        INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "smsAutoMinLevel"   TEXT    NOT NULL DEFAULT 'overdue';
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "smsDailyMax"       INTEGER NOT NULL DEFAULT 200;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "smsTemplate"       TEXT;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "contactPhone"      TEXT;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "escalationEnabled" BOOLEAN NOT NULL DEFAULT false;

-- 2. Eskalatsiya qoidalari (korxona × daraja)
CREATE TABLE IF NOT EXISTS "ekohisob_escalation_rules" (
    "id"               TEXT NOT NULL,
    "orgId"            TEXT NOT NULL,
    "level"            TEXT NOT NULL,
    "smsEnabled"       BOOLEAN NOT NULL DEFAULT false,
    "notifyInspector"  BOOLEAN NOT NULL DEFAULT false,
    "notifyManager"    BOOLEAN NOT NULL DEFAULT false,
    "suggestBlacklist" BOOLEAN NOT NULL DEFAULT false,
    "isActive"         BOOLEAN NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ekohisob_escalation_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ekohisob_escalation_rules_orgId_level_key"
    ON "ekohisob_escalation_rules"("orgId", "level");
CREATE INDEX IF NOT EXISTS "ekohisob_escalation_rules_orgId_idx"
    ON "ekohisob_escalation_rules"("orgId");

-- 3. Eskalatsiya jurnali — bir daraja uchun amal bir marta bajarilishi kafolati
CREATE TABLE IF NOT EXISTS "ekohisob_escalation_logs" (
    "id"        TEXT NOT NULL,
    "orgId"     TEXT NOT NULL,
    "entityId"  TEXT NOT NULL,
    "level"     TEXT NOT NULL,
    "action"    TEXT NOT NULL,
    "detail"    TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ekohisob_escalation_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ekohisob_escalation_logs_entityId_level_action_key"
    ON "ekohisob_escalation_logs"("entityId", "level", "action");
CREATE INDEX IF NOT EXISTS "ekohisob_escalation_logs_orgId_createdAt_idx"
    ON "ekohisob_escalation_logs"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "ekohisob_escalation_logs_entityId_idx"
    ON "ekohisob_escalation_logs"("entityId");
