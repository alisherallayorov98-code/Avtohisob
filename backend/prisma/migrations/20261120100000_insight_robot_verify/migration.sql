-- Tahlil robot: avtomatik yuborish, javobni tekshirish, tasodifiy tekshiruv
ALTER TABLE "insight_requests" ADD COLUMN IF NOT EXISTS "autoSent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "insight_requests" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
ALTER TABLE "insight_requests" ADD COLUMN IF NOT EXISTS "verifyNotes" JSONB;
ALTER TABLE "insight_requests" ADD COLUMN IF NOT EXISTS "spotCheckAt" TIMESTAMP(3);
ALTER TABLE "insight_requests" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
