-- FuelReading.driverId/driverName — anomaliya vaqtidagi haydovchi.
-- Waybill cross-check (actualDeparture..actualReturn oralig'ida) natijasi.
-- "Sliv vaqtida 01 A 123 mashinasida Karimov S. yo'l varaqasida edi".
-- IDEMPOTENT.

ALTER TABLE "fuel_readings" ADD COLUMN IF NOT EXISTS "driverId" TEXT;
ALTER TABLE "fuel_readings" ADD COLUMN IF NOT EXISTS "driverName" TEXT;
