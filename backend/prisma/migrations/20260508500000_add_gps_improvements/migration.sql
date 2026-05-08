-- GPS improvements: track snapshot + time inside + settings-aware monitoring params

ALTER TABLE "th_service_trips"
  ADD COLUMN IF NOT EXISTS "timeInsideMin" INTEGER,
  ADD COLUMN IF NOT EXISTS "trackSnapshot" JSONB;

ALTER TABLE "th_settings"
  ADD COLUMN IF NOT EXISTS "gridCellM"        INTEGER NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS "coverageRadiusM"  INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS "minVisitSec"      INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "monitorStartHour" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS "monitorEndHour"   INTEGER NOT NULL DEFAULT 18;
