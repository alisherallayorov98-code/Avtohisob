ALTER TABLE "suppliers" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "suppliers_organizationId_idx" ON "suppliers"("organizationId");
