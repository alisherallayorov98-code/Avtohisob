-- EkoHisob SMS eslatma jurnali (Eskiz.uz orqali yuborilgan SMS lar)
CREATE TABLE "ekohisob_sms_logs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityId" TEXT,
    "phone" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "providerMsgId" TEXT,
    "error" TEXT,
    "sentBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ekohisob_sms_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ekohisob_sms_logs_orgId_idx" ON "ekohisob_sms_logs"("orgId");
CREATE INDEX "ekohisob_sms_logs_entityId_idx" ON "ekohisob_sms_logs"("entityId");
CREATE INDEX "ekohisob_sms_logs_createdAt_idx" ON "ekohisob_sms_logs"("createdAt");
