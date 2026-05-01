-- Multi-tenant: Warehouse.organizationId qo'shish (additive, nullable)
-- Eski yozuvlar Branch.warehouseId orqali backfill qilinadi.
-- Eski (hech bir branchga bog'lanmagan) warehouse'lar NULL qoladi —
-- ular faqat super_admin'ga ko'rinadi (warehouses kontrollerida cheklangan).

ALTER TABLE "warehouses"
  ADD COLUMN "organizationId" TEXT;

-- Backfill: har bir warehouse uchun unga bog'langan birinchi (eng eski)
-- branchning organizationId'ini olib o'rnatadi. Agar branch'da organizationId
-- NULL bo'lsa, branch.id'ni org sifatida ishlatadi (resolveOrgId mantig'i).
UPDATE "warehouses" w
SET "organizationId" = sub.org_id
FROM (
  SELECT DISTINCT ON (b."warehouseId")
         b."warehouseId" AS warehouse_id,
         COALESCE(b."organizationId", b.id) AS org_id
  FROM "branches" b
  WHERE b."warehouseId" IS NOT NULL
  ORDER BY b."warehouseId", b."createdAt" ASC
) sub
WHERE w.id = sub.warehouse_id
  AND w."organizationId" IS NULL;

-- Index for filter performance
CREATE INDEX "warehouses_organizationId_idx" ON "warehouses"("organizationId");
