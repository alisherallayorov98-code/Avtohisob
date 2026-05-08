-- AI Coverage Fingerprint: katak chastotasi (necha oyda qoplangan)
ALTER TABLE "th_coverage_fingerprints"
  ADD COLUMN IF NOT EXISTS "cellFrequencies" JSONB;
-- Format: [[lat_int, lon_int, count]] — lat*1e6 va lon*1e6 rounded int, count=1-6
