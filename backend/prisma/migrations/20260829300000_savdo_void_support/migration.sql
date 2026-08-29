-- AvtoHisob Savdo — sotuv/kirim/to'lovni bekor qilish (audit iz bilan, joyida
-- o'zgartirmasdan). Idempotent — qayta ishga tushirish xavfsiz.

ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "cancelledById" TEXT;
ALTER TABLE "savdo_purchases" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

ALTER TABLE "savdo_sales" ADD COLUMN IF NOT EXISTS "cancelledById" TEXT;
ALTER TABLE "savdo_sales" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

ALTER TABLE "savdo_payments" ADD COLUMN IF NOT EXISTS "cancelled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "savdo_payments" ADD COLUMN IF NOT EXISTS "cancelledById" TEXT;
ALTER TABLE "savdo_payments" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "savdo_purchases_status_idx" ON "savdo_purchases"("status");
CREATE INDEX IF NOT EXISTS "savdo_payments_cancelled_idx" ON "savdo_payments"("cancelled");
