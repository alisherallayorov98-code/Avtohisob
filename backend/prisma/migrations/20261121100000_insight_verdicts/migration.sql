-- Tahlil: admin hukmlari jurnali (to'g'ri / noto'g'ri / normal) va qoida aniqligi
CREATE TABLE IF NOT EXISTS "insight_verdicts" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "vehicleId" TEXT,
  "title" TEXT,
  "confidence" TEXT,
  "verdict" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "resolution" TEXT,
  "dismissalId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insight_verdicts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "insight_verdicts_orgId_ruleKey_idx" ON "insight_verdicts"("orgId", "ruleKey");
CREATE INDEX IF NOT EXISTS "insight_verdicts_orgId_fingerprint_idx" ON "insight_verdicts"("orgId", "fingerprint");
