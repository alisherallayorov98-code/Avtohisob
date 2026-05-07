-- AlterTable: Toza-Hudud sozlamalariga bildirishnoma va haydovchi PIN maydonlari
ALTER TABLE "th_settings"
  ADD COLUMN IF NOT EXISTS "notify_on_monitor_complete" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notify_on_low_coverage"     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notify_min_coverage_pct"    INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "driver_access_enabled"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "driver_pin_hash"            TEXT;
