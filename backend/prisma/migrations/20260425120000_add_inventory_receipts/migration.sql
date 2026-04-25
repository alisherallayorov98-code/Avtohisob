CREATE TABLE IF NOT EXISTS "inventory_receipts" (
  "id"           TEXT NOT NULL,
  "sparePartId"  TEXT NOT NULL,
  "warehouseId"  TEXT NOT NULL,
  "quantity"     INTEGER NOT NULL,
  "unitPrice"    DECIMAL(12,2) NOT NULL DEFAULT 0,
  "receivedById" TEXT,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_receipts_sparePartId_fkey" FOREIGN KEY ("sparePartId") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_receipts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "inventory_receipts_warehouseId_idx" ON "inventory_receipts"("warehouseId");
CREATE INDEX IF NOT EXISTS "inventory_receipts_sparePartId_idx" ON "inventory_receipts"("sparePartId");
CREATE INDEX IF NOT EXISTS "inventory_receipts_createdAt_idx" ON "inventory_receipts"("createdAt");
