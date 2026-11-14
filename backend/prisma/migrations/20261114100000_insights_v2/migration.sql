-- Tahlil v2: savolni mas'ulga topshirish va tashkilot chegaralari
CREATE TABLE IF NOT EXISTS "insight_assignments" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "vehicleId" TEXT,
  "title" TEXT NOT NULL,
  "actionPath" TEXT,
  "assigneeId" TEXT NOT NULL,
  "assignedById" TEXT,
  "dueDate" TIMESTAMP(3),
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insight_assignments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "insight_assignments_orgId_status_idx" ON "insight_assignments"("orgId", "status");
CREATE INDEX IF NOT EXISTS "insight_assignments_orgId_fingerprint_idx" ON "insight_assignments"("orgId", "fingerprint");
CREATE INDEX IF NOT EXISTS "insight_assignments_assigneeId_idx" ON "insight_assignments"("assigneeId");

CREATE TABLE IF NOT EXISTS "insight_settings" (
  "orgId" TEXT NOT NULL,
  "thresholds" JSONB NOT NULL,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insight_settings_pkey" PRIMARY KEY ("orgId")
);
