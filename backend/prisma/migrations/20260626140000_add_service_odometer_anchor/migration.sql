-- ServiceInterval ga Wialon-shkala langar: xizmat paytidagi vehicle.mileage.
-- Jonli "yurgan km" = joriy mileage − serviceOdometerKm. null = eski yozuv (eski formula).
ALTER TABLE "service_intervals" ADD COLUMN IF NOT EXISTS "serviceOdometerKm" INTEGER;
