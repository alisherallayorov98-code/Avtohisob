-- Import partiyalari: bir importda yaratilgan qismlarni birga bekor qilish uchun
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "type" TEXT NOT NULL,
    "fileName" TEXT,
    "createdById" TEXT,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "import_batches_organizationId_idx" ON "import_batches"("organizationId");

-- spare_parts: import partiyasiga havola (mavjud bo'lmasa qo'shamiz)
ALTER TABLE "spare_parts" ADD COLUMN IF NOT EXISTS "importBatchId" TEXT;
CREATE INDEX IF NOT EXISTS "spare_parts_importBatchId_idx" ON "spare_parts"("importBatchId");
ALTER TABLE "spare_parts" ADD CONSTRAINT "spare_parts_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
