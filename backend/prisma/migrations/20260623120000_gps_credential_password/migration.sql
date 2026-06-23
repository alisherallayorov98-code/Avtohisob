-- GpsCredential: ixtiyoriy shifrlangan parol (token to'liq o'lsa avto re-login uchun)
ALTER TABLE "gps_credentials" ADD COLUMN IF NOT EXISTS "password" TEXT;
