-- Savdo qayta ishlash: kasr miqdor, yuridik mijoz, import kirim hujjati, QQS, spetsifikatsiya, inventarizatsiya qoralamasi
ALTER TABLE "savdo_purchases" ALTER COLUMN "quantity" TYPE DECIMAL(14,3);
ALTER TABLE "savdo_stock" ALTER COLUMN "quantityOnHand" TYPE DECIMAL(14,3);
ALTER TABLE "savdo_stock" ALTER COLUMN "reorderLevel" TYPE DECIMAL(14,3);
ALTER TABLE "savdo_cost_layers" ALTER COLUMN "quantity" TYPE DECIMAL(14,3);
ALTER TABLE "savdo_cost_layers" ALTER COLUMN "remainingQty" TYPE DECIMAL(14,3);
ALTER TABLE "savdo_sale_lines" ALTER COLUMN "quantity" TYPE DECIMAL(14,3);
ALTER TABLE "savdo_cost_consumptions" ALTER COLUMN "quantity" TYPE DECIMAL(14,3);
ALTER TABLE "savdo_inventory_count_lines" ALTER COLUMN "systemQty" TYPE DECIMAL(14,3);
ALTER TABLE "savdo_inventory_count_lines" ALTER COLUMN "countedQty" TYPE DECIMAL(14,3);
ALTER TABLE "savdo_inventory_count_lines" ALTER COLUMN "diffQty" TYPE DECIMAL(14,3);
ALTER TABLE "savdo_transfers" ALTER COLUMN "quantity" TYPE DECIMAL(14,3);

ALTER TABLE "savdo_customers" ADD COLUMN IF NOT EXISTS "isLegal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "savdo_customers" ADD COLUMN IF NOT EXISTS "stir" TEXT;
ALTER TABLE "savdo_customers" ADD COLUMN IF NOT EXISTS "bankAccount" TEXT;
ALTER TABLE "savdo_customers" ADD COLUMN IF NOT EXISTS "bankName" TEXT;
ALTER TABLE "savdo_customers" ADD COLUMN IF NOT EXISTS "mfo" TEXT;
ALTER TABLE "savdo_customers" ADD COLUMN IF NOT EXISTS "director" TEXT;
ALTER TABLE "savdo_customers" ADD COLUMN IF NOT EXISTS "contractNumber" TEXT;
ALTER TABLE "savdo_customers" ADD COLUMN IF NOT EXISTS "contractDate" TIMESTAMP(3);

ALTER TABLE "savdo_sales" ADD COLUMN IF NOT EXISTS "vatRate" DECIMAL(5,2);
ALTER TABLE "savdo_sales" ADD COLUMN IF NOT EXISTS "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "savdo_sales" ADD COLUMN IF NOT EXISTS "specId" TEXT;

ALTER TABLE "savdo_inventory_counts" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'confirmed';

CREATE TABLE IF NOT EXISTS "savdo_purchase_docs" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "supplierId" TEXT,
  "invoiceNumber" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'UZS',
  "exchangeRate" DECIMAL(14,4) NOT NULL DEFAULT 1,
  "allocBy" TEXT NOT NULL DEFAULT 'value',
  "isOfficial" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "createdById" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "savdo_purchase_docs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_purchase_docs_orgId_idx" ON "savdo_purchase_docs"("orgId");

ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "docId" TEXT;
ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "foreignPrice" DECIMAL(14,4);
ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "extraCost" DECIMAL(14,2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "savdo_purchases_docId_idx" ON "savdo_purchases"("docId");
DO $$ BEGIN
  ALTER TABLE "savdo_purchases" ADD CONSTRAINT "savdo_purchases_docId_fkey"
    FOREIGN KEY ("docId") REFERENCES "savdo_purchase_docs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "savdo_purchase_costs" (
  "id" TEXT NOT NULL,
  "docId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "savdo_purchase_costs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_purchase_costs_docId_idx" ON "savdo_purchase_costs"("docId");
DO $$ BEGIN
  ALTER TABLE "savdo_purchase_costs" ADD CONSTRAINT "savdo_purchase_costs_docId_fkey"
    FOREIGN KEY ("docId") REFERENCES "savdo_purchase_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "savdo_specs" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "contractNumber" TEXT,
  "contractDate" TIMESTAMP(3),
  "vatRate" DECIMAL(5,2),
  "paymentTerms" TEXT,
  "deliveryTerms" TEXT,
  "validUntil" TIMESTAMP(3),
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "saleId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "savdo_specs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "savdo_specs_number_key" ON "savdo_specs"("number");
CREATE INDEX IF NOT EXISTS "savdo_specs_orgId_idx" ON "savdo_specs"("orgId");
CREATE INDEX IF NOT EXISTS "savdo_specs_customerId_idx" ON "savdo_specs"("customerId");
DO $$ BEGIN
  ALTER TABLE "savdo_specs" ADD CONSTRAINT "savdo_specs_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "savdo_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "savdo_spec_lines" (
  "id" TEXT NOT NULL,
  "specId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "savdo_spec_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_spec_lines_specId_idx" ON "savdo_spec_lines"("specId");
DO $$ BEGIN
  ALTER TABLE "savdo_spec_lines" ADD CONSTRAINT "savdo_spec_lines_specId_fkey"
    FOREIGN KEY ("specId") REFERENCES "savdo_specs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
