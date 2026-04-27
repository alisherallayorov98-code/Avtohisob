-- CreateTable
CREATE TABLE "th_containers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gpsZoneName" TEXT,
    "organizationId" TEXT NOT NULL,
    "mfyId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusM" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "th_containers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "th_containers_organizationId_idx" ON "th_containers"("organizationId");
CREATE INDEX "th_containers_mfyId_idx" ON "th_containers"("mfyId");

-- AddForeignKey
ALTER TABLE "th_containers" ADD CONSTRAINT "th_containers_mfyId_fkey" FOREIGN KEY ("mfyId") REFERENCES "th_mfys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
