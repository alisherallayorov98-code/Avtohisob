-- CreateTable
CREATE TABLE "telegram_notification_prefs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "insurance" BOOLEAN NOT NULL DEFAULT true,
    "techInspection" BOOLEAN NOT NULL DEFAULT true,
    "oilChange" BOOLEAN NOT NULL DEFAULT true,
    "fuelAnomaly" BOOLEAN NOT NULL DEFAULT true,
    "sparePart" BOOLEAN NOT NULL DEFAULT true,
    "maintenance" BOOLEAN NOT NULL DEFAULT true,
    "monthlyInspection" BOOLEAN NOT NULL DEFAULT true,
    "vehicleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_notification_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_notification_prefs_userId_key" ON "telegram_notification_prefs"("userId");

-- AddForeignKey
ALTER TABLE "telegram_notification_prefs" ADD CONSTRAINT "telegram_notification_prefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
