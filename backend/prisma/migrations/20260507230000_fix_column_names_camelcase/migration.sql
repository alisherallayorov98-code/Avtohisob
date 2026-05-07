-- Fix: avvalgi migration'larda snake_case noto'g'ri ustun nomlari yaratildi.
-- Prisma @map() yo'q bo'lganda camelCase ustun nomlarini kutadi.
-- Bu migration eski snake_case nomlarni to'g'ri camelCase nomga o'zgartiradi.

-- ── th_service_trips: coverage_pct → coveragePct ─────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_service_trips' AND column_name = 'coverage_pct'
  ) THEN
    ALTER TABLE "th_service_trips" RENAME COLUMN "coverage_pct" TO "coveragePct";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_service_trips' AND column_name = 'coveragePct'
  ) THEN
    ALTER TABLE "th_service_trips" ADD COLUMN "coveragePct" INTEGER;
  END IF;
END $$;

-- ── th_settings: notify_* va driver_* ustunlarini camelCase ga o'tkazish ─────

DO $$
BEGIN
  -- notify_on_monitor_complete → notifyOnMonitorComplete
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_settings' AND column_name = 'notify_on_monitor_complete'
  ) THEN
    ALTER TABLE "th_settings" RENAME COLUMN "notify_on_monitor_complete" TO "notifyOnMonitorComplete";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_settings' AND column_name = 'notifyOnMonitorComplete'
  ) THEN
    ALTER TABLE "th_settings" ADD COLUMN "notifyOnMonitorComplete" BOOLEAN NOT NULL DEFAULT true;
  END IF;

  -- notify_on_low_coverage → notifyOnLowCoverage
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_settings' AND column_name = 'notify_on_low_coverage'
  ) THEN
    ALTER TABLE "th_settings" RENAME COLUMN "notify_on_low_coverage" TO "notifyOnLowCoverage";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_settings' AND column_name = 'notifyOnLowCoverage'
  ) THEN
    ALTER TABLE "th_settings" ADD COLUMN "notifyOnLowCoverage" BOOLEAN NOT NULL DEFAULT true;
  END IF;

  -- notify_min_coverage_pct → notifyMinCoveragePct
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_settings' AND column_name = 'notify_min_coverage_pct'
  ) THEN
    ALTER TABLE "th_settings" RENAME COLUMN "notify_min_coverage_pct" TO "notifyMinCoveragePct";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_settings' AND column_name = 'notifyMinCoveragePct'
  ) THEN
    ALTER TABLE "th_settings" ADD COLUMN "notifyMinCoveragePct" INTEGER NOT NULL DEFAULT 60;
  END IF;

  -- driver_access_enabled → driverAccessEnabled
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_settings' AND column_name = 'driver_access_enabled'
  ) THEN
    ALTER TABLE "th_settings" RENAME COLUMN "driver_access_enabled" TO "driverAccessEnabled";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_settings' AND column_name = 'driverAccessEnabled'
  ) THEN
    ALTER TABLE "th_settings" ADD COLUMN "driverAccessEnabled" BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- driver_pin_hash → driverPinHash
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_settings' AND column_name = 'driver_pin_hash'
  ) THEN
    ALTER TABLE "th_settings" RENAME COLUMN "driver_pin_hash" TO "driverPinHash";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'th_settings' AND column_name = 'driverPinHash'
  ) THEN
    ALTER TABLE "th_settings" ADD COLUMN "driverPinHash" TEXT;
  END IF;
END $$;
