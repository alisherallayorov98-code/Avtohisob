/*
  Warnings:

  - You are about to drop the column `fromBranchId` on the `inventory_transfers` table. All the data in the column will be lost.
  - You are about to drop the column `toBranchId` on the `inventory_transfers` table. All the data in the column will be lost.
  - Added the required column `fromWarehouseId` to the `inventory_transfers` table without a default value. This is not possible if the table is not empty.
  - Added the required column `toWarehouseId` to the `inventory_transfers` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "inventory_transfers" DROP CONSTRAINT "inventory_transfers_fromBranchId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_transfers" DROP CONSTRAINT "inventory_transfers_toBranchId_fkey";

-- DropIndex
DROP INDEX "inventory_transfers_fromBranchId_idx";

-- DropIndex
DROP INDEX "inventory_transfers_toBranchId_idx";

-- AlterTable
ALTER TABLE "inventory_transfers" DROP COLUMN "fromBranchId",
DROP COLUMN "toBranchId",
ADD COLUMN     "fromWarehouseId" TEXT NOT NULL,
ADD COLUMN     "toWarehouseId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "warehouses" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "inventory_transfers_fromWarehouseId_idx" ON "inventory_transfers"("fromWarehouseId");

-- CreateIndex
CREATE INDEX "inventory_transfers_toWarehouseId_idx" ON "inventory_transfers"("toWarehouseId");

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
