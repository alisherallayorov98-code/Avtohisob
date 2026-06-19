-- Yakka haydovchi bot: premium + referal
ALTER TABLE "driver_bot_users" ADD COLUMN IF NOT EXISTS "premiumUntil" TIMESTAMP(3);
ALTER TABLE "driver_bot_users" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "driver_bot_users" ADD COLUMN IF NOT EXISTS "referredById" TEXT;
ALTER TABLE "driver_bot_users" ADD COLUMN IF NOT EXISTS "referralRewarded" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "driver_bot_users_referralCode_key" ON "driver_bot_users"("referralCode");
CREATE INDEX IF NOT EXISTS "driver_bot_users_referredById_idx" ON "driver_bot_users"("referredById");
