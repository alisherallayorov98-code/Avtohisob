-- Vazifa-mashina-kun bajarilish yozuvi (nazorat paneli uchun)
CREATE TABLE "vehicle_care_submissions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "driverChatId" TEXT,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "mediaType" TEXT,
    "mediaPath" TEXT,
    "mediaHash" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_care_submissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vehicle_care_submissions_taskId_vehicleId_dueDate_key" ON "vehicle_care_submissions"("taskId", "vehicleId", "dueDate");
CREATE INDEX "vehicle_care_submissions_organizationId_dueDate_idx" ON "vehicle_care_submissions"("organizationId", "dueDate");
CREATE INDEX "vehicle_care_submissions_vehicleId_idx" ON "vehicle_care_submissions"("vehicleId");
CREATE INDEX "vehicle_care_submissions_status_idx" ON "vehicle_care_submissions"("status");
