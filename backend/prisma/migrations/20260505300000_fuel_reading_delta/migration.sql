-- FuelReading.deltaL — anomaliya bilan birga o'zgarish miqdori (litr).
-- Tejov hisoblagichi va xarita modal'da ishlatish uchun kerak.
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS — qayta ishga tushirsa xavfsiz.
-- Eski FuelReading yozuvlari deltaL=null bilan ishlayveradi.

ALTER TABLE "fuel_readings" ADD COLUMN IF NOT EXISTS "deltaL" DOUBLE PRECISION;
