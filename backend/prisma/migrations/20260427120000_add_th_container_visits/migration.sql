-- CreateTable
CREATE TABLE "th_container_visits" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "durationMin" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "th_container_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "th_container_visits_vehicleId_idx" ON "th_container_visits"("vehicleId");
CREATE INDEX "th_container_visits_containerId_idx" ON "th_container_visits"("containerId");
CREATE INDEX "th_container_visits_date_idx" ON "th_container_visits"("date");
CREATE INDEX "th_container_visits_vehicleId_date_idx" ON "th_container_visits"("vehicleId", "date");

-- AddForeignKey
ALTER TABLE "th_container_visits" ADD CONSTRAINT "th_container_visits_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "th_containers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
