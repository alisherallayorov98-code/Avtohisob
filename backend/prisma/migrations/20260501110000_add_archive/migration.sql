-- CreateTable: Universal arxiv (o'chirilgan ma'lumotlar uchun)
CREATE TABLE "archive" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "organizationId" TEXT,
    "deletedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isRestored" BOOLEAN NOT NULL DEFAULT false,
    "restoredAt" TIMESTAMP(3),

    CONSTRAINT "archive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "archive_entityType_entityId_idx" ON "archive"("entityType", "entityId");
CREATE INDEX "archive_organizationId_idx" ON "archive"("organizationId");
CREATE INDEX "archive_deletedAt_idx" ON "archive"("deletedAt");
CREATE INDEX "archive_expiresAt_idx" ON "archive"("expiresAt");

-- AddForeignKey
ALTER TABLE "archive" ADD CONSTRAINT "archive_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
