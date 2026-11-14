-- Tahlil: filialga so'rov va yozishmalar
CREATE TABLE IF NOT EXISTS "insight_requests" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "vehicleId" TEXT,
  "plate" TEXT,
  "title" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "evidence" JSONB,
  "quick" JSONB,
  "actionPath" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "dueDate" TIMESTAMP(3),
  "createdById" TEXT,
  "answeredById" TEXT,
  "answeredAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insight_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "insight_requests_orgId_status_idx" ON "insight_requests"("orgId", "status");
CREATE INDEX IF NOT EXISTS "insight_requests_branchId_status_idx" ON "insight_requests"("branchId", "status");
CREATE INDEX IF NOT EXISTS "insight_requests_orgId_fingerprint_idx" ON "insight_requests"("orgId", "fingerprint");

CREATE TABLE IF NOT EXISTS "insight_request_messages" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "userId" TEXT,
  "userName" TEXT,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insight_request_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "insight_request_messages_requestId_idx" ON "insight_request_messages"("requestId");
DO $$ BEGIN
  ALTER TABLE "insight_request_messages" ADD CONSTRAINT "insight_request_messages_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "insight_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
