-- Qisman to'lov: bir oyga bir necha to'lov yozuvi ruxsat etiladi.
-- entityId+month unique constraint olib tashlanadi, oddiy index bilan almashtiriladi.

-- DropIndex (unique constraint)
DROP INDEX IF EXISTS "ekohisob_payments_entityId_month_key";

-- CreateIndex (oddiy, unique emas)
CREATE INDEX IF NOT EXISTS "ekohisob_payments_entityId_month_idx" ON "ekohisob_payments"("entityId", "month");
