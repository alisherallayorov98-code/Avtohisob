-- EkoHisob robot yordamchi: yashirish, hukmlar, inspektor topshiriqlari (hammasi IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS "ekohisob_insight_dismissals" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "entityId" TEXT,
  "title" TEXT,
  "reason" TEXT NOT NULL,
  "until" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdByName" TEXT NOT NULL DEFAULT '—',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ekohisob_insight_dismissals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ekohisob_insight_dismissals_orgId_fingerprint_idx" ON "ekohisob_insight_dismissals"("orgId", "fingerprint");

CREATE TABLE IF NOT EXISTS "ekohisob_insight_verdicts" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "entityId" TEXT,
  "title" TEXT,
  "confidence" TEXT,
  "verdict" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "resolution" TEXT,
  "sourceChecked" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT,
  "createdByName" TEXT NOT NULL DEFAULT '—',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ekohisob_insight_verdicts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ekohisob_insight_verdicts_orgId_ruleKey_idx" ON "ekohisob_insight_verdicts"("orgId", "ruleKey");
CREATE INDEX IF NOT EXISTS "ekohisob_insight_verdicts_orgId_fingerprint_idx" ON "ekohisob_insight_verdicts"("orgId", "fingerprint");

CREATE TABLE IF NOT EXISTS "ekohisob_insight_tasks" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "entityId" TEXT,
  "districtId" TEXT,
  "title" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "evidence" JSONB,
  "assigneeId" TEXT NOT NULL,
  "assignedBy" TEXT,
  "autoSent" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'open',
  "dueDate" TIMESTAMP(3),
  "answer" TEXT,
  "answeredAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "verifyNote" TEXT,
  "closedAt" TIMESTAMP(3),
  "closedBy" TEXT,
  "notifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ekohisob_insight_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ekohisob_insight_tasks_orgId_status_idx" ON "ekohisob_insight_tasks"("orgId", "status");
CREATE INDEX IF NOT EXISTS "ekohisob_insight_tasks_orgId_fingerprint_idx" ON "ekohisob_insight_tasks"("orgId", "fingerprint");
CREATE INDEX IF NOT EXISTS "ekohisob_insight_tasks_assigneeId_status_idx" ON "ekohisob_insight_tasks"("assigneeId", "status");
