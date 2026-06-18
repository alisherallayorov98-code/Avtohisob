-- Yakka haydovchi reysida ovqat xarajatini alohida kuzatish
ALTER TABLE "driver_trips" ADD COLUMN IF NOT EXISTS "foodCost" INTEGER NOT NULL DEFAULT 0;
