-- EkoHisob: akt sverka (solishtirma dalolatnoma) uchun xizmat ko'rsatuvchi
-- tomon rekvizitlari. Hujjat ikki tomonlama — ikkalasining ma'lumoti kerak.
-- Idempotent: mavjud ustunni buzmaydi.

ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "orgOfficialName" TEXT;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "orgStir"         TEXT;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "orgAddress"      TEXT;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "orgPhone"        TEXT;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "orgBankAccount"  TEXT;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "orgBankName"     TEXT;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "orgMfo"          TEXT;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "orgDirector"     TEXT;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "orgAccountant"   TEXT;

-- To'lovlarni sana bo'yicha saralash (akt sverka xronologiyasi) tez bo'lishi uchun
CREATE INDEX IF NOT EXISTS "ekohisob_payments_entityId_paidAt_idx"
    ON "ekohisob_payments"("entityId", "paidAt");
