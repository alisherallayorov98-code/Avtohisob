ALTER TABLE "maintenance_records" ADD COLUMN IF NOT EXISTS "evidenceOtpCode" TEXT;
ALTER TABLE "maintenance_records" ADD COLUMN IF NOT EXISTS "evidenceOtpExpiry" TIMESTAMP(3);
