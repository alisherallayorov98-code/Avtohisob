CREATE TABLE IF NOT EXISTS "th_holidays" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "th_holidays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "th_holidays_organizationId_date_key" ON "th_holidays"("organizationId", "date");
CREATE INDEX IF NOT EXISTS "th_holidays_organizationId_idx" ON "th_holidays"("organizationId");
CREATE INDEX IF NOT EXISTS "th_holidays_date_idx" ON "th_holidays"("date");
