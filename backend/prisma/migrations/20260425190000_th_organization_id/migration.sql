-- Multi-tenant: Toza-Hudud entitylariga organizationId qo'shish

-- 1) Avval nullable qilib qo'shamiz
ALTER TABLE "th_regions" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "th_districts" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "th_mfys" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "th_landfills" ADD COLUMN "organizationId" TEXT;

-- 2) Backfill: birinchi tashkilot (organizationId IS NULL bo'lgan branch) ga biriktiramiz
-- Branch.organizationId NULL bo'lsa o'zi organization rolini bajaradi.
DO $$
DECLARE
  default_org_id TEXT;
BEGIN
  -- Eng birinchi tashkilot id sini topamiz
  SELECT COALESCE(b."organizationId", b.id) INTO default_org_id
  FROM "branches" b
  ORDER BY b."createdAt" ASC
  LIMIT 1;

  IF default_org_id IS NOT NULL THEN
    UPDATE "th_regions"   SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "th_districts" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "th_mfys"      SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
    UPDATE "th_landfills" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
  END IF;
END $$;

-- 3) NOT NULL ga o'tkazamiz (faqat ma'lumot bo'lsa — bo'sh bo'lsa muammo yo'q)
ALTER TABLE "th_regions"   ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "th_districts" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "th_mfys"      ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "th_landfills" ALTER COLUMN "organizationId" SET NOT NULL;

-- 4) Indekslar
CREATE INDEX "th_regions_organizationId_idx"   ON "th_regions"("organizationId");
CREATE INDEX "th_districts_organizationId_idx" ON "th_districts"("organizationId");
CREATE INDEX "th_mfys_organizationId_idx"      ON "th_mfys"("organizationId");
CREATE INDEX "th_landfills_organizationId_idx" ON "th_landfills"("organizationId");
