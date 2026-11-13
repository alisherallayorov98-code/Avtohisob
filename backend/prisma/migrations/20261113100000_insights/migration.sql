-- Tahlil (robot yordamchi): yashirilgan savollar va kunlik holat
CREATE TABLE IF NOT EXISTS "insight_dismissals" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "vehicleId" TEXT,
  "title" TEXT,
  "reason" TEXT NOT NULL,
  "until" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insight_dismissals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "insight_dismissals_orgId_idx" ON "insight_dismissals"("orgId");
CREATE INDEX IF NOT EXISTS "insight_dismissals_orgId_fingerprint_idx" ON "insight_dismissals"("orgId", "fingerprint");

CREATE TABLE IF NOT EXISTS "insight_snapshots" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "total" INTEGER NOT NULL DEFAULT 0,
  "critical" INTEGER NOT NULL DEFAULT 0,
  "warning" INTEGER NOT NULL DEFAULT 0,
  "info" INTEGER NOT NULL DEFAULT 0,
  "fingerprints" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insight_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "insight_snapshots_orgId_date_key" ON "insight_snapshots"("orgId", "date");
