-- EkoHisob: tashkilot turi (yuridik / YaTT / jismoniy shaxs) va Soliq bilan oxirgi sinxronlash vaqti.
-- Idempotent. Mavjud barcha tashkilotlar 'legal' bo'lib qoladi (xatti-harakat o'zgarmaydi).
ALTER TABLE "ekohisob_legal_entities" ADD COLUMN IF NOT EXISTS "entityType"    TEXT NOT NULL DEFAULT 'legal';
ALTER TABLE "ekohisob_legal_entities" ADD COLUMN IF NOT EXISTS "soliqSyncedAt" TIMESTAMP(3);
