-- AlterTable: tashkilotga bir kub narxi (talon rejimi uchun)
ALTER TABLE "ekohisob_legal_entities"
  ADD COLUMN IF NOT EXISTS "cubicPrice" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: EkoHisobTalon (talon asosida — kub × narx)
CREATE TABLE IF NOT EXISTS "ekohisob_talons" (
  "id"        TEXT             NOT NULL,
  "entityId"  TEXT             NOT NULL,
  "orgId"     TEXT             NOT NULL,
  "volume"    DOUBLE PRECISION NOT NULL,
  "amount"    INTEGER          NOT NULL,
  "date"      DATE             NOT NULL,
  "note"      TEXT,
  "createdBy" TEXT,
  "paid"      BOOLEAN          NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ekohisob_talons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ekohisob_talons_entityId_idx" ON "ekohisob_talons"("entityId");
CREATE INDEX IF NOT EXISTS "ekohisob_talons_orgId_idx"    ON "ekohisob_talons"("orgId");
CREATE INDEX IF NOT EXISTS "ekohisob_talons_date_idx"     ON "ekohisob_talons"("date");

DO $$ BEGIN
  ALTER TABLE "ekohisob_talons"
    ADD CONSTRAINT "ekohisob_talons_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "ekohisob_legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
