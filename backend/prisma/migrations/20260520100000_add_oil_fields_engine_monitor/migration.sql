-- maintenance_records: yog' aniqlash maydonlari (engine monitor uchun)
ALTER TABLE "maintenance_records" ADD COLUMN IF NOT EXISTS "isOil" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "maintenance_records" ADD COLUMN IF NOT EXISTS "oilLiters" DOUBLE PRECISION;

-- th_mfy_streets: OSM ko'cha segmentlari (db push orqali yaratilgan edi — migrate uchun ro'yxatga olinmoqda)
CREATE TABLE IF NOT EXISTS "th_mfy_streets" (
    "id" TEXT NOT NULL,
    "mfyId" TEXT NOT NULL,
    "osmWayId" TEXT NOT NULL,
    "name" TEXT,
    "highway" TEXT,
    "geometry" JSONB NOT NULL,
    "lengthM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "th_mfy_streets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "th_mfy_streets_mfyId_osmWayId_key" ON "th_mfy_streets"("mfyId", "osmWayId");
CREATE INDEX IF NOT EXISTS "th_mfy_streets_mfyId_idx" ON "th_mfy_streets"("mfyId");

-- FK constraint: mavjud bo'lsa xato chiqarmasin
DO $$ BEGIN
    ALTER TABLE "th_mfy_streets" ADD CONSTRAINT "th_mfy_streets_mfyId_fkey"
        FOREIGN KEY ("mfyId") REFERENCES "th_mfys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
