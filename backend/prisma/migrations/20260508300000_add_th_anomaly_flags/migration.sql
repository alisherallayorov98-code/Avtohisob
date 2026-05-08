-- Toza-Hudud: ThServiceTrip ga anomalyFlags JSONB ustun qo'shish
-- {tooFast: bool, timeTooShort: bool, linearTrack: bool, edgeOnly: bool}
-- Existing suspicious field: faqat tezlik bo'yicha. anomalyFlags ko'proq qatlam beradi.

ALTER TABLE "th_service_trips"
  ADD COLUMN IF NOT EXISTS "anomalyFlags" JSONB;
