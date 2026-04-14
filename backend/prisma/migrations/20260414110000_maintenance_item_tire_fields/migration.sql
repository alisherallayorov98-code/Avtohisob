-- AlterTable: add tire integration fields to maintenance_items
ALTER TABLE "maintenance_items"
  ADD COLUMN "isTire"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tireSerial"   TEXT,
  ADD COLUMN "tirePosition" TEXT,
  ADD COLUMN "tireId"       TEXT;
