CREATE TABLE IF NOT EXISTS "th_regions" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "th_regions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "th_districts" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "regionId"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "th_districts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "th_districts_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "th_regions"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "th_districts_regionId_idx" ON "th_districts"("regionId");

CREATE TABLE IF NOT EXISTS "th_mfys" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "districtId" TEXT NOT NULL,
  "polygon"    JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "th_mfys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "th_mfys_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "th_districts"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "th_mfys_districtId_idx" ON "th_mfys"("districtId");

CREATE TABLE IF NOT EXISTS "th_streets" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "mfyId"      TEXT NOT NULL,
  "linestring" JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "th_streets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "th_streets_mfyId_fkey" FOREIGN KEY ("mfyId") REFERENCES "th_mfys"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "th_streets_mfyId_idx" ON "th_streets"("mfyId");

CREATE TABLE IF NOT EXISTS "th_landfills" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "location"  TEXT,
  "polygon"   JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "th_landfills_pkey" PRIMARY KEY ("id")
);
