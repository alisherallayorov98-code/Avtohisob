-- Kilometrga bog'liq texnik parvarish vazifalari
ALTER TABLE "vehicle_care_tasks" ADD COLUMN "triggerType" TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE "vehicle_care_tasks" ADD COLUMN "intervalKm" INTEGER;

ALTER TABLE "vehicle_care_submissions" ADD COLUMN "triggerKm" DECIMAL(65,30);
ALTER TABLE "vehicle_care_submissions" ADD COLUMN "doneKm" DECIMAL(65,30);

CREATE TABLE "vehicle_care_mileage_states" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "lastKm" DECIMAL(65,30) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_care_mileage_states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vehicle_care_mileage_states_taskId_vehicleId_key" ON "vehicle_care_mileage_states"("taskId", "vehicleId");
CREATE INDEX "vehicle_care_mileage_states_vehicleId_idx" ON "vehicle_care_mileage_states"("vehicleId");
