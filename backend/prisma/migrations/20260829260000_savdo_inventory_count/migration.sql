-- AvtoHisob Savdo — inventarizatsiya (jismoniy sanash + qoldiqni tuzatish tarixi).
-- Idempotent — qayta ishga tushirish xavfsiz.

CREATE TABLE IF NOT EXISTS "savdo_inventory_counts" (
    "id"          TEXT NOT NULL,
    "orgId"       TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "countedById" TEXT NOT NULL,
    "countedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes"       TEXT,

    CONSTRAINT "savdo_inventory_counts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_inventory_counts_orgId_idx" ON "savdo_inventory_counts"("orgId");
CREATE INDEX IF NOT EXISTS "savdo_inventory_counts_warehouseId_idx" ON "savdo_inventory_counts"("warehouseId");

DO $$ BEGIN
  ALTER TABLE "savdo_inventory_counts" ADD CONSTRAINT "savdo_inventory_counts_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "savdo_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "savdo_inventory_count_lines" (
    "id"         TEXT NOT NULL,
    "countId"    TEXT NOT NULL,
    "productId"  TEXT NOT NULL,
    "systemQty"  INTEGER NOT NULL,
    "countedQty" INTEGER NOT NULL,
    "diffQty"    INTEGER NOT NULL,
    "unitCost"   DECIMAL(12,2) NOT NULL,
    "diffValue"  DECIMAL(14,2) NOT NULL,

    CONSTRAINT "savdo_inventory_count_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_inventory_count_lines_countId_idx" ON "savdo_inventory_count_lines"("countId");
CREATE INDEX IF NOT EXISTS "savdo_inventory_count_lines_productId_idx" ON "savdo_inventory_count_lines"("productId");

DO $$ BEGIN
  ALTER TABLE "savdo_inventory_count_lines" ADD CONSTRAINT "savdo_inventory_count_lines_countId_fkey"
    FOREIGN KEY ("countId") REFERENCES "savdo_inventory_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_inventory_count_lines" ADD CONSTRAINT "savdo_inventory_count_lines_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "savdo_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
