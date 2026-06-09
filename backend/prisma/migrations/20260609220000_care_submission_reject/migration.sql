-- Admin tasdiq/rad etish uchun maydonlar
ALTER TABLE "vehicle_care_submissions" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "vehicle_care_submissions" ADD COLUMN "rejectedReason" TEXT;
