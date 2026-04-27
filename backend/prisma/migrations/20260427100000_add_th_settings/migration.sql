-- CreateTable
CREATE TABLE "th_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "suspiciousSpeedKmh" INTEGER NOT NULL DEFAULT 25,
    "autoMonitorEnabled" BOOLEAN NOT NULL DEFAULT true,
    "coverageGreenPct" INTEGER NOT NULL DEFAULT 80,
    "coverageYellowPct" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "th_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "th_settings_organizationId_key" ON "th_settings"("organizationId");
