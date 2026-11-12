-- Audit jurnali
CREATE TABLE IF NOT EXISTS "savdo_audit_logs" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityLabel" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "userId" TEXT,
  "userName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "savdo_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "savdo_audit_logs_orgId_createdAt_idx" ON "savdo_audit_logs"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "savdo_audit_logs_entity_entityId_idx" ON "savdo_audit_logs"("entity", "entityId");

-- Hujjat tahrirlanganda eski qatorlar "bekor qilingan" bo'lib Kirim ro'yxatida eski narx bilan qolardi.
-- Endi ular 'replaced' (almashtirilgan) holatida va ro'yxatda ko'rinmaydi. Eski yozuvlarni tuzatish:
-- hujjat qatorlarida valyutadagi narx (foreignPrice) bor, tahrirda docId uziladi -> docId NULL + foreignPrice bor + cancelled.
UPDATE "savdo_purchases" SET "status" = 'replaced'
  WHERE "status" = 'cancelled' AND "docId" IS NULL AND "foreignPrice" IS NOT NULL;
