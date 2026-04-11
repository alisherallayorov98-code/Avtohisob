-- AlterTable: add labor cost, worker name, payment tracking
ALTER TABLE "maintenance_records" 
  ADD COLUMN IF NOT EXISTS "laborCost"    DECIMAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "workerName"   TEXT,
  ADD COLUMN IF NOT EXISTS "paymentType"  TEXT NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS "isPaid"       BOOLEAN NOT NULL DEFAULT true,
  ALTER COLUMN "sparePartId" DROP NOT NULL,
  ALTER COLUMN "quantityUsed" SET DEFAULT 0,
  ALTER COLUMN "cost" SET DEFAULT 0;
