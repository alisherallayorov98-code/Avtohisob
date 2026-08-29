-- AvtoHisob Savdo — 3-bosqich: mijozlar, sotuv/faktura, FIFO tannarx sarfi (COGS).
-- Idempotent — qayta ishga tushirish xavfsiz.

-- Hujjat raqamlash — ekohisob_receipt_seq bilan bir xil atomik-increment patterni.
CREATE TABLE IF NOT EXISTS "savdo_doc_seq" (
    "orgId"   TEXT NOT NULL,
    "year"    INTEGER NOT NULL DEFAULT 0,
    "lastNum" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "savdo_doc_seq_pkey" PRIMARY KEY ("orgId")
);

CREATE TABLE IF NOT EXISTS "savdo_customers" (
    "id"        TEXT NOT NULL,
    "orgId"     TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "phone"     TEXT,
    "address"   TEXT,
    "priceTier" TEXT NOT NULL DEFAULT 'retail',
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savdo_customers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_customers_orgId_idx" ON "savdo_customers"("orgId");

CREATE TABLE IF NOT EXISTS "savdo_sales" (
    "id"             TEXT NOT NULL,
    "orgId"          TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "customerId"     TEXT,
    "warehouseId"    TEXT NOT NULL,
    "saleType"       TEXT NOT NULL DEFAULT 'invoice',
    "status"         TEXT NOT NULL DEFAULT 'completed',
    "totalAmount"    DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalCost"      DECIMAL(14,2) NOT NULL DEFAULT 0,
    "kassaSmenaId"   TEXT,
    "soldById"       TEXT,
    "notes"          TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savdo_sales_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "savdo_sales_documentNumber_key" ON "savdo_sales"("documentNumber");
CREATE INDEX IF NOT EXISTS "savdo_sales_orgId_idx" ON "savdo_sales"("orgId");
CREATE INDEX IF NOT EXISTS "savdo_sales_customerId_idx" ON "savdo_sales"("customerId");
CREATE INDEX IF NOT EXISTS "savdo_sales_createdAt_idx" ON "savdo_sales"("createdAt");

DO $$ BEGIN
  ALTER TABLE "savdo_sales" ADD CONSTRAINT "savdo_sales_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "savdo_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_sales" ADD CONSTRAINT "savdo_sales_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "savdo_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "savdo_sale_lines" (
    "id"        TEXT NOT NULL,
    "saleId"    TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity"  INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "unitCost"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "lineCost"  DECIMAL(14,2) NOT NULL,

    CONSTRAINT "savdo_sale_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_sale_lines_saleId_idx" ON "savdo_sale_lines"("saleId");
CREATE INDEX IF NOT EXISTS "savdo_sale_lines_productId_idx" ON "savdo_sale_lines"("productId");

DO $$ BEGIN
  ALTER TABLE "savdo_sale_lines" ADD CONSTRAINT "savdo_sale_lines_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "savdo_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_sale_lines" ADD CONSTRAINT "savdo_sale_lines_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "savdo_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "savdo_cost_consumptions" (
    "id"          TEXT NOT NULL,
    "saleLineId"  TEXT NOT NULL,
    "costLayerId" TEXT NOT NULL,
    "quantity"    INTEGER NOT NULL,
    "unitCost"    DECIMAL(12,2) NOT NULL,

    CONSTRAINT "savdo_cost_consumptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_cost_consumptions_saleLineId_idx" ON "savdo_cost_consumptions"("saleLineId");
CREATE INDEX IF NOT EXISTS "savdo_cost_consumptions_costLayerId_idx" ON "savdo_cost_consumptions"("costLayerId");

DO $$ BEGIN
  ALTER TABLE "savdo_cost_consumptions" ADD CONSTRAINT "savdo_cost_consumptions_saleLineId_fkey"
    FOREIGN KEY ("saleLineId") REFERENCES "savdo_sale_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_cost_consumptions" ADD CONSTRAINT "savdo_cost_consumptions_costLayerId_fkey"
    FOREIGN KEY ("costLayerId") REFERENCES "savdo_cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
