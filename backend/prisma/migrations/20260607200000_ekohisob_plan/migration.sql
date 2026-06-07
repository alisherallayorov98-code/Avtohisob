-- Tashkilotga "kim kiritdi" (plan progressi uchun)
ALTER TABLE "ekohisob_legal_entities" ADD COLUMN "createdBy" TEXT;

-- Kunlik plan (topshiriq) — supervisor/admin inspektorga beradi
CREATE TABLE "ekohisob_plans" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "assignedById" TEXT,
    "date" DATE NOT NULL,
    "targetCount" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'new_entity',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ekohisob_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ekohisob_plans_inspectorId_date_type_key" ON "ekohisob_plans"("inspectorId", "date", "type");
CREATE INDEX "ekohisob_plans_orgId_idx" ON "ekohisob_plans"("orgId");
CREATE INDEX "ekohisob_plans_inspectorId_idx" ON "ekohisob_plans"("inspectorId");
CREATE INDEX "ekohisob_plans_date_idx" ON "ekohisob_plans"("date");

ALTER TABLE "ekohisob_plans" ADD CONSTRAINT "ekohisob_plans_inspectorId_fkey"
    FOREIGN KEY ("inspectorId") REFERENCES "ekohisob_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
