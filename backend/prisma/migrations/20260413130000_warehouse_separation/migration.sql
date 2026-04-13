-- CreateTable: warehouses
CREATE TABLE "warehouses" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "location" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- Add warehouseId to branches (nullable first)
ALTER TABLE "branches" ADD COLUMN "warehouseId" TEXT;

-- Create one warehouse per branch that owns its own warehouse (sharedWarehouseId IS NULL)
-- Use _tempBranchId to safely link back without name collision
ALTER TABLE "warehouses" ADD COLUMN "_tempBranchId" TEXT;

INSERT INTO "warehouses" ("id", "name", "location", "createdAt", "updatedAt", "_tempBranchId")
SELECT gen_random_uuid(), b."name", b."location", NOW(), NOW(), b."id"
FROM "branches" b
WHERE b."sharedWarehouseId" IS NULL;

-- Link own-warehouse branches to their new warehouse
UPDATE "branches" b
SET "warehouseId" = w."id"
FROM "warehouses" w
WHERE w."_tempBranchId" = b."id";

-- Link shared-warehouse branches to the warehouse of the branch they share
UPDATE "branches" b
SET "warehouseId" = b2."warehouseId"
FROM "branches" b2
WHERE b."sharedWarehouseId" = b2."id"
  AND b2."warehouseId" IS NOT NULL;

-- Drop temp column
ALTER TABLE "warehouses" DROP COLUMN "_tempBranchId";

-- Add FK: branches.warehouseId -> warehouses.id
ALTER TABLE "branches" ADD CONSTRAINT "branches_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop old sharedWarehouseId FK and column from branches
ALTER TABLE "branches" DROP CONSTRAINT IF EXISTS "branches_sharedWarehouseId_fkey";
ALTER TABLE "branches" DROP COLUMN IF EXISTS "sharedWarehouseId";

-- Add warehouseId to inventory (nullable first)
ALTER TABLE "inventory" ADD COLUMN "warehouseId" TEXT;

-- Migrate inventory: set warehouseId from branch's warehouseId
UPDATE "inventory" i
SET "warehouseId" = b."warehouseId"
FROM "branches" b
WHERE i."branchId" = b."id"
  AND b."warehouseId" IS NOT NULL;

-- For any inventory not yet linked (branch had no warehouseId), use branchId as fallback
UPDATE "inventory" i
SET "warehouseId" = i."branchId"
WHERE i."warehouseId" IS NULL;

-- Drop old unique constraint, index, FK on inventory.branchId
ALTER TABLE "inventory" DROP CONSTRAINT IF EXISTS "inventory_sparePartId_branchId_key";
DROP INDEX IF EXISTS "inventory_branchId_idx";
ALTER TABLE "inventory" DROP CONSTRAINT IF EXISTS "inventory_branchId_fkey";
ALTER TABLE "inventory" DROP COLUMN IF EXISTS "branchId";

-- Make warehouseId NOT NULL
ALTER TABLE "inventory" ALTER COLUMN "warehouseId" SET NOT NULL;

-- Add FK: inventory.warehouseId -> warehouses.id
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add new unique constraint and index
CREATE UNIQUE INDEX "inventory_sparePartId_warehouseId_key" ON "inventory"("sparePartId", "warehouseId");
CREATE INDEX "inventory_warehouseId_idx" ON "inventory"("warehouseId");
