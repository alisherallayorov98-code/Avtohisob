-- Add installationMileage column to capture vehicle odometer at time of maintenance.
-- Nullable to preserve historical records. New records auto-capture from vehicle.mileage.
ALTER TABLE "maintenance_records" ADD COLUMN "installationMileage" INTEGER;
