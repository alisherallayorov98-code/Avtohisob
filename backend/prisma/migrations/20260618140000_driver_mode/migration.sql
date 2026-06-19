-- Yakka haydovchi rejimi: truck (yuk/foyda) yoki personal (shaxsiy/xarajat)
ALTER TABLE "driver_bot_users" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'truck';
