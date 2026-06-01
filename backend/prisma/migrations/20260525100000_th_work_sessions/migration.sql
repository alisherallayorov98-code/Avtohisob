-- AlterTable: ThSetting ga ish vaqti maydonlari qo'shish
ALTER TABLE "th_settings"
  ADD COLUMN IF NOT EXISTS "workStartTime"        TEXT    NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS "workEndTime"          TEXT    NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS "workTrackingEnabled"  BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: ThWorkSession
CREATE TABLE IF NOT EXISTS "th_work_sessions" (
  "id"             TEXT        NOT NULL,
  "organizationId" TEXT        NOT NULL,
  "vehicleId"      TEXT        NOT NULL,
  "date"           DATE        NOT NULL,
  "firstGpsAt"     TIMESTAMP(3),
  "lastGpsAt"      TIMESTAMP(3),
  "durationMin"    INTEGER     NOT NULL DEFAULT 0,
  "startStatus"    TEXT        NOT NULL DEFAULT 'absent',
  "endStatus"      TEXT,
  "lateStartMin"   INTEGER     NOT NULL DEFAULT 0,
  "earlyEndMin"    INTEGER     NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "th_work_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "th_work_sessions_vehicleId_date_key" ON "th_work_sessions"("vehicleId", "date");
CREATE INDEX IF NOT EXISTS "th_work_sessions_organizationId_date_idx" ON "th_work_sessions"("organizationId", "date");
CREATE INDEX IF NOT EXISTS "th_work_sessions_vehicleId_idx" ON "th_work_sessions"("vehicleId");
