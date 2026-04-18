ALTER TABLE "telegram_notification_prefs" ADD COLUMN "branchIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
