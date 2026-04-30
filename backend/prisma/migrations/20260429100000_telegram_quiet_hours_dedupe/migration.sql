-- AlterTable: Yangi pref maydonlari
ALTER TABLE "telegram_notification_prefs" ADD COLUMN "dailySummary" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "telegram_notification_prefs" ADD COLUMN "weeklySummary" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "telegram_notification_prefs" ADD COLUMN "pendingApproval" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "telegram_notification_prefs" ADD COLUMN "quietStart" INTEGER;
ALTER TABLE "telegram_notification_prefs" ADD COLUMN "quietEnd" INTEGER;

-- CreateTable: Anti-spam dedup
CREATE TABLE "telegram_alert_dedupe" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_alert_dedupe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_alert_dedupe_userId_alertType_targetKey_key" ON "telegram_alert_dedupe"("userId", "alertType", "targetKey");
CREATE INDEX "telegram_alert_dedupe_sentAt_idx" ON "telegram_alert_dedupe"("sentAt");
