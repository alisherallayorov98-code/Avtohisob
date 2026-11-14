-- Spetsifikatsiya: sotuvdan avtomatik yaratilganini belgilash
ALTER TABLE "savdo_specs" ADD COLUMN IF NOT EXISTS "autoFromSale" BOOLEAN NOT NULL DEFAULT false;

-- Zakaz (buyurtma) → yig'ish → sotuv
CREATE TABLE IF NOT EXISTS "savdo_orders" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "vatRate" DECIMAL(5,2),
    "paymentType" TEXT NOT NULL DEFAULT 'credit',
    "dueDate" TIMESTAMP(3),
    "deliverAt" TIMESTAMP(3),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "saleId" TEXT,
    "createdById" TEXT,
    "pickedById" TEXT,
    "pickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "savdo_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "savdo_order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(12,2),
    "pickedQty" DECIMAL(14,3),
    CONSTRAINT "savdo_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "savdo_orders_orgId_status_idx" ON "savdo_orders"("orgId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "savdo_orders_orgId_number_key" ON "savdo_orders"("orgId", "number");
CREATE INDEX IF NOT EXISTS "savdo_order_lines_orderId_idx" ON "savdo_order_lines"("orderId");

DO $$ BEGIN
  ALTER TABLE "savdo_orders" ADD CONSTRAINT "savdo_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "savdo_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "savdo_order_lines" ADD CONSTRAINT "savdo_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "savdo_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
