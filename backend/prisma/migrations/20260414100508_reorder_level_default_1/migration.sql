-- AlterTable
ALTER TABLE "inventory" ALTER COLUMN "reorderLevel" SET DEFAULT 1;

-- Update existing rows that still have the old default of 5
UPDATE "inventory" SET "reorderLevel" = 1 WHERE "reorderLevel" = 5;
