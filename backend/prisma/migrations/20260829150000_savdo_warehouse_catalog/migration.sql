-- AvtoHisob Savdo — 2-bosqich: katalog, ombor, kirim (xarid), qoldiq, FIFO tannarx qatlami.
-- Idempotent — qayta ishga tushirish xavfsiz.

CREATE TABLE IF NOT EXISTS "savdo_warehouses" (
    "id"        TEXT NOT NULL,
    "orgId"     TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "location"  TEXT,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savdo_warehouses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_warehouses_orgId_idx" ON "savdo_warehouses"("orgId");

CREATE TABLE IF NOT EXISTS "savdo_products" (
    "id"             TEXT NOT NULL,
    "orgId"          TEXT NOT NULL,
    "sku"            TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "category"       TEXT,
    "unit"           TEXT NOT NULL DEFAULT 'dona',
    "wholesalePrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "retailPrice"    DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savdo_products_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "savdo_products_orgId_sku_key" ON "savdo_products"("orgId", "sku");
CREATE INDEX IF NOT EXISTS "savdo_products_orgId_idx" ON "savdo_products"("orgId");

CREATE TABLE IF NOT EXISTS "savdo_suppliers" (
    "id"            TEXT NOT NULL,
    "orgId"         TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone"         TEXT,
    "address"       TEXT,
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savdo_suppliers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_suppliers_orgId_idx" ON "savdo_suppliers"("orgId");

CREATE TABLE IF NOT EXISTS "savdo_purchases" (
    "id"            TEXT NOT NULL,
    "orgId"         TEXT NOT NULL,
    "productId"     TEXT NOT NULL,
    "warehouseId"   TEXT NOT NULL,
    "quantity"      INTEGER NOT NULL,
    "unitCost"      DECIMAL(12,2) NOT NULL,
    "isOfficial"    BOOLEAN NOT NULL DEFAULT true,
    "supplierId"    TEXT,
    "invoiceNumber" TEXT,
    "receivedById"  TEXT,
    "notes"         TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savdo_purchases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_purchases_orgId_idx" ON "savdo_purchases"("orgId");
CREATE INDEX IF NOT EXISTS "savdo_purchases_warehouseId_idx" ON "savdo_purchases"("warehouseId");
CREATE INDEX IF NOT EXISTS "savdo_purchases_productId_idx" ON "savdo_purchases"("productId");
CREATE INDEX IF NOT EXISTS "savdo_purchases_createdAt_idx" ON "savdo_purchases"("createdAt");

DO $$ BEGIN
  ALTER TABLE "savdo_purchases" ADD CONSTRAINT "savdo_purchases_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "savdo_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_purchases" ADD CONSTRAINT "savdo_purchases_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "savdo_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_purchases" ADD CONSTRAINT "savdo_purchases_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "savdo_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "savdo_stock" (
    "id"             TEXT NOT NULL,
    "productId"      TEXT NOT NULL,
    "warehouseId"    TEXT NOT NULL,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel"   INTEGER NOT NULL DEFAULT 0,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savdo_stock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "savdo_stock_productId_warehouseId_key" ON "savdo_stock"("productId", "warehouseId");
CREATE INDEX IF NOT EXISTS "savdo_stock_warehouseId_idx" ON "savdo_stock"("warehouseId");

DO $$ BEGIN
  ALTER TABLE "savdo_stock" ADD CONSTRAINT "savdo_stock_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "savdo_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_stock" ADD CONSTRAINT "savdo_stock_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "savdo_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "savdo_cost_layers" (
    "id"           TEXT NOT NULL,
    "orgId"        TEXT NOT NULL,
    "purchaseId"   TEXT NOT NULL,
    "productId"    TEXT NOT NULL,
    "warehouseId"  TEXT NOT NULL,
    "unitCost"     DECIMAL(12,2) NOT NULL,
    "quantity"     INTEGER NOT NULL,
    "remainingQty" INTEGER NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savdo_cost_layers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "savdo_cost_layers_purchaseId_key" ON "savdo_cost_layers"("purchaseId");
CREATE INDEX IF NOT EXISTS "savdo_cost_layers_orgId_idx" ON "savdo_cost_layers"("orgId");
CREATE INDEX IF NOT EXISTS "savdo_cost_layers_productId_warehouseId_createdAt_idx" ON "savdo_cost_layers"("productId", "warehouseId", "createdAt");
CREATE INDEX IF NOT EXISTS "savdo_cost_layers_remainingQty_idx" ON "savdo_cost_layers"("remainingQty");

DO $$ BEGIN
  ALTER TABLE "savdo_cost_layers" ADD CONSTRAINT "savdo_cost_layers_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "savdo_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_cost_layers" ADD CONSTRAINT "savdo_cost_layers_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "savdo_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_cost_layers" ADD CONSTRAINT "savdo_cost_layers_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "savdo_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
