-- EkoHisob qayta ishlash: qisman talon to'lovi, kvitansiya storno, idempotentlik,
-- SMS segment/opt-out, eskalatsiya qayta urinish, tashrif qaydlari, login himoyasi, indekslar.
-- Idempotent: har buyruq IF NOT EXISTS. Mavjud ma'lumot o'zgarmaydi (faqat talon.paidAmount backfill).

-- ── Talon: qisman to'lov ─────────────────────────────────────────────────────
ALTER TABLE "ekohisob_talons" ADD COLUMN IF NOT EXISTS "paidAmount" INTEGER NOT NULL DEFAULT 0;
UPDATE "ekohisob_talons" SET "paidAmount" = "amount" WHERE "paid" = true AND "paidAmount" = 0;

-- ── To'lov: usul + idempotentlik kaliti ─────────────────────────────────────
ALTER TABLE "ekohisob_payments" ADD COLUMN IF NOT EXISTS "method" TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE "ekohisob_payments" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ekohisob_payments_idempotencyKey_key" ON "ekohisob_payments"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "ekohisob_payments_receivedBy_paidAt_idx" ON "ekohisob_payments"("receivedBy", "paidAt");

-- ── Kvitansiya: storno (o'chirilmaydi, bekor qilinadi) + ochiq tekshiruv tokeni ──
ALTER TABLE "ekohisob_receipts" ADD COLUMN IF NOT EXISTS "voidedAt"    TIMESTAMP(3);
ALTER TABLE "ekohisob_receipts" ADD COLUMN IF NOT EXISTS "voidReason"  TEXT;
ALTER TABLE "ekohisob_receipts" ADD COLUMN IF NOT EXISTS "voidedBy"    TEXT;
ALTER TABLE "ekohisob_receipts" ADD COLUMN IF NOT EXISTS "verifyToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ekohisob_receipts_verifyToken_key" ON "ekohisob_receipts"("verifyToken");
-- To'lov o'chirilganda kvitansiya yo'qolmasin: paymentId ixtiyoriy, FK -> SET NULL
ALTER TABLE "ekohisob_receipts" ALTER COLUMN "paymentId" DROP NOT NULL;
ALTER TABLE "ekohisob_receipts" DROP CONSTRAINT IF EXISTS "ekohisob_receipts_paymentId_fkey";
ALTER TABLE "ekohisob_receipts"
  ADD CONSTRAINT "ekohisob_receipts_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "ekohisob_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Tashkilot: SMS rad etish + indekslar ─────────────────────────────────────
ALTER TABLE "ekohisob_legal_entities" ADD COLUMN IF NOT EXISTS "smsOptOut" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "ekohisob_legal_entities_orgId_debtLevel_idx" ON "ekohisob_legal_entities"("orgId", "debtLevel");
CREATE INDEX IF NOT EXISTS "ekohisob_legal_entities_orgId_createdBy_createdAt_idx" ON "ekohisob_legal_entities"("orgId", "createdBy", "createdAt");

-- ── SMS jurnali: segment, tur, davr ──────────────────────────────────────────
ALTER TABLE "ekohisob_sms_logs" ADD COLUMN IF NOT EXISTS "segments"  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ekohisob_sms_logs" ADD COLUMN IF NOT EXISTS "kind"      TEXT; -- auto | escalation | manual
ALTER TABLE "ekohisob_sms_logs" ADD COLUMN IF NOT EXISTS "periodKey" TEXT; -- "YYYY-MM" (oylik dedup)
CREATE INDEX IF NOT EXISTS "ekohisob_sms_logs_orgId_status_createdAt_idx" ON "ekohisob_sms_logs"("orgId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ekohisob_sms_logs_phone_idx" ON "ekohisob_sms_logs"("phone");

-- ── Eskalatsiya jurnali: muvaffaqiyatsizlikni qayta urinish ──────────────────
ALTER TABLE "ekohisob_escalation_logs" ADD COLUMN IF NOT EXISTS "status"   TEXT NOT NULL DEFAULT 'done'; -- done | failed
ALTER TABLE "ekohisob_escalation_logs" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 1;

-- ── Sozlamalar: to'lov muddati kuni (1 = hozirgi xatti-harakat), avto-SMS oxirgi oyi ──
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "paymentDueDay"    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ekohisob_org_settings" ADD COLUMN IF NOT EXISTS "smsAutoLastMonth" TEXT;

-- ── Foydalanuvchi: sessiya bekor qilish, login qulfi ─────────────────────────
ALTER TABLE "ekohisob_users" ADD COLUMN IF NOT EXISTS "tokenVersion"       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ekohisob_users" ADD COLUMN IF NOT EXISTS "failedLogins"       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ekohisob_users" ADD COLUMN IF NOT EXISTS "lockedUntil"        TIMESTAMP(3);
ALTER TABLE "ekohisob_users" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- ── Tashrif / "to'lamadi" / va'da qaydlari ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "ekohisob_visits" (
  "id"           TEXT NOT NULL,
  "orgId"        TEXT NOT NULL,
  "entityId"     TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "kind"         TEXT NOT NULL, -- not_paid | promised | visited
  "reason"       TEXT,
  "promisedDate" DATE,
  "photoFileId"  TEXT,
  "lat"          DOUBLE PRECISION,
  "lon"          DOUBLE PRECISION,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ekohisob_visits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ekohisob_visits_orgId_createdAt_idx" ON "ekohisob_visits"("orgId", "createdAt");
CREATE INDEX IF NOT EXISTS "ekohisob_visits_entityId_idx" ON "ekohisob_visits"("entityId");
CREATE INDEX IF NOT EXISTS "ekohisob_visits_userId_createdAt_idx" ON "ekohisob_visits"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ekohisob_visits_promisedDate_idx" ON "ekohisob_visits"("promisedDate");
