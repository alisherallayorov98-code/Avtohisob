-- Add organizationId to branches (self-referencing: root org branch = its own id)
ALTER TABLE "branches"
  ADD COLUMN "organizationId" TEXT;

ALTER TABLE "branches"
  ADD CONSTRAINT "branches_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "branches_organizationId_idx" ON "branches"("organizationId");

-- Backfill: branches that already have an admin user become their own org root
UPDATE "branches" b
SET "organizationId" = b.id
WHERE EXISTS (
  SELECT 1 FROM "users" u
  WHERE u."branchId" = b.id
    AND u."role" = 'admin'
);
