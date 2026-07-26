-- EkoHisob: Excel importi (partiya + undo) va miqyoslash indekslari.
-- Barcha amallar idempotent — qayta ishga tushirish xavfsiz.

-- 1. Import partiyasi — noto'g'ri fayl yuklansa ortga qaytarish uchun
CREATE TABLE IF NOT EXISTS "ekohisob_import_batches" (
    "id"        TEXT NOT NULL,
    "orgId"     TEXT NOT NULL,
    "userId"    TEXT,
    "userName"  TEXT NOT NULL DEFAULT '—',
    "fileName"  TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "created"   INTEGER NOT NULL DEFAULT 0,
    "updated"   INTEGER NOT NULL DEFAULT 0,
    "skipped"   INTEGER NOT NULL DEFAULT 0,
    "failed"    INTEGER NOT NULL DEFAULT 0,
    "undoneAt"  TIMESTAMP(3),
    "undoneBy"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ekohisob_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ekohisob_import_batches_orgId_createdAt_idx"
    ON "ekohisob_import_batches"("orgId", "createdAt");

-- 2. Tashkilot qaysi import partiyasidan kelgani (undo uchun)
ALTER TABLE "ekohisob_legal_entities" ADD COLUMN IF NOT EXISTS "importBatchId" TEXT;
CREATE INDEX IF NOT EXISTS "ekohisob_legal_entities_importBatchId_idx"
    ON "ekohisob_legal_entities"("importBatchId");

-- 3. Miqyoslash indekslari — dashboard/hisobot agregatlari uchun.
--    Ilgari bu so'rovlar barcha tashkilotni nested bog'lanishlar bilan yuklardi.
CREATE INDEX IF NOT EXISTS "ekohisob_legal_entities_orgId_status_idx"
    ON "ekohisob_legal_entities"("orgId", "status");
CREATE INDEX IF NOT EXISTS "ekohisob_talons_entityId_paid_idx"
    ON "ekohisob_talons"("entityId", "paid");
CREATE INDEX IF NOT EXISTS "ekohisob_charges_entityId_status_idx"
    ON "ekohisob_charges"("entityId", "status");
