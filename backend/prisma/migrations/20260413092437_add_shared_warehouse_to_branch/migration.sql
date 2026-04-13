/*
  Warnings:

  - You are about to alter the column `laborCost` on the `maintenance_records` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.

*/
-- DropForeignKey
ALTER TABLE "maintenance_records" DROP CONSTRAINT "maintenance_records_sparePartId_fkey";

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "sharedWarehouseId" TEXT;

-- AlterTable
ALTER TABLE "maintenance_records" ALTER COLUMN "laborCost" SET DATA TYPE DECIMAL(65,30);

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_sharedWarehouseId_fkey" FOREIGN KEY ("sharedWarehouseId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_sparePartId_fkey" FOREIGN KEY ("sparePartId") REFERENCES "spare_parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
