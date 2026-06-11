-- Yoqilg'i narx tarixi — sana bo'yicha narx izlash
CREATE TABLE IF NOT EXISTS "fuel_price_history" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fuelType"       TEXT NOT NULL,
  "pricePerUnit"   DECIMAL(65,30) NOT NULL,
  "effectiveFrom"  DATE NOT NULL,
  "note"           TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fuel_price_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fuel_price_history_organizationId_fuelType_effectiveFrom_idx"
  ON "fuel_price_history"("organizationId", "fuelType", "effectiveFrom");
