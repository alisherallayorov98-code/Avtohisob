-- AlterTable: InventoryTransfer - add batchId
ALTER TABLE "inventory_transfers" ADD COLUMN "batchId" TEXT;

-- CreateTable: TransferBatch
CREATE TABLE "transfer_batches" (
    "id" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "requestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "shippedAt" TIMESTAMP(3),
    "shippedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SparePartRequest
CREATE TABLE "spare_part_requests" (
    "id" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "urgency" TEXT NOT NULL DEFAULT 'medium',
    "notes" TEXT,
    "responseNotes" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedById" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spare_part_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SparePartRequestItem
CREATE TABLE "spare_part_request_items" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sparePartId" TEXT,
    "partName" TEXT NOT NULL,
    "partCode" TEXT,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spare_part_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transfer_batches_documentNumber_key" ON "transfer_batches"("documentNumber");
CREATE INDEX "transfer_batches_orgId_idx" ON "transfer_batches"("orgId");
CREATE INDEX "transfer_batches_status_idx" ON "transfer_batches"("status");
CREATE INDEX "transfer_batches_fromWarehouseId_idx" ON "transfer_batches"("fromWarehouseId");
CREATE INDEX "transfer_batches_toWarehouseId_idx" ON "transfer_batches"("toWarehouseId");

CREATE UNIQUE INDEX "spare_part_requests_documentNumber_key" ON "spare_part_requests"("documentNumber");
CREATE INDEX "spare_part_requests_orgId_idx" ON "spare_part_requests"("orgId");
CREATE INDEX "spare_part_requests_branchId_idx" ON "spare_part_requests"("branchId");
CREATE INDEX "spare_part_requests_status_idx" ON "spare_part_requests"("status");

CREATE INDEX "spare_part_request_items_requestId_idx" ON "spare_part_request_items"("requestId");
CREATE INDEX "inventory_transfers_batchId_idx" ON "inventory_transfers"("batchId");

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "transfer_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transfer_batches" ADD CONSTRAINT "transfer_batches_fromWarehouseId_fkey"
    FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transfer_batches" ADD CONSTRAINT "transfer_batches_toWarehouseId_fkey"
    FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transfer_batches" ADD CONSTRAINT "transfer_batches_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "spare_part_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transfer_batches" ADD CONSTRAINT "transfer_batches_shippedById_fkey"
    FOREIGN KEY ("shippedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transfer_batches" ADD CONSTRAINT "transfer_batches_receivedById_fkey"
    FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transfer_batches" ADD CONSTRAINT "transfer_batches_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "spare_part_requests" ADD CONSTRAINT "spare_part_requests_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "spare_part_requests" ADD CONSTRAINT "spare_part_requests_respondedById_fkey"
    FOREIGN KEY ("respondedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "spare_part_request_items" ADD CONSTRAINT "spare_part_request_items_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "spare_part_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "spare_part_request_items" ADD CONSTRAINT "spare_part_request_items_sparePartId_fkey"
    FOREIGN KEY ("sparePartId") REFERENCES "spare_parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
