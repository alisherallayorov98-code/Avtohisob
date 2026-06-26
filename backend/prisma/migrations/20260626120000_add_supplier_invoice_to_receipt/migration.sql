-- AlterTable: InventoryReceipt ga supplierId va invoiceNumber qo'shish
ALTER TABLE "inventory_receipts" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;
ALTER TABLE "inventory_receipts" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;

-- AddForeignKey
ALTER TABLE "inventory_receipts" DROP CONSTRAINT IF EXISTS "inventory_receipts_supplierId_fkey";
ALTER TABLE "inventory_receipts" ADD CONSTRAINT "inventory_receipts_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for supplier filter performance
CREATE INDEX IF NOT EXISTS "inventory_receipts_supplierId_idx" ON "inventory_receipts"("supplierId");
