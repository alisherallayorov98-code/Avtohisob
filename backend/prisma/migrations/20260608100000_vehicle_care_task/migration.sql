-- Mashina texnik parvarishi — davriy vazifalar (havo filtri, smazka...)
CREATE TABLE "vehicle_care_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "scope" TEXT NOT NULL DEFAULT 'all',
    "branchId" TEXT,
    "vehicleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_care_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vehicle_care_tasks_organizationId_idx" ON "vehicle_care_tasks"("organizationId");
